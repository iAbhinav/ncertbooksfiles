import puppeteer from "puppeteer";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { setTimeout } from "timers/promises";

interface Chapter {
  title: string;
  pdfUrl: string;
}

interface Book {
  title: string;
  coverUrl?: string;
  chapters: Chapter[];
}

interface SubjectGroup {
  subject: string;
  books: Book[];
}

interface ClassGroup {
  class: string;
  subjects: SubjectGroup[];
}

// Load checkpoint if it exists and find last processed position
interface ResumePosition {
  classIndex: number;
  className: string;
  subjectIndex: number;
  subjectName: string;
  bookIndex: number;
  bookName: string;
  lastChapter: string | null;
}

let resumePosition: ResumePosition | null = null;

function loadCheckpoint(): ClassGroup[] {
  try {
    if (existsSync('./checkpoint.json')) {
      console.log('📋 Loading from checkpoint...');
      const data = readFileSync('./checkpoint.json', 'utf8');
      const checkpoint = JSON.parse(data) as ClassGroup[];
      
      // Find the last position in the checkpoint
      findResumePosition(checkpoint);
      
      return checkpoint;
    }
  } catch (error) {
    console.error('Error loading checkpoint:', error);
  }
  return [];
}

function findResumePosition(checkpoint: ClassGroup[]): void {
  if (!checkpoint || checkpoint.length === 0) return;
  
  // Start with the assumption that we need to continue from the beginning
  let position: ResumePosition = {
    classIndex: 0,
    className: '',
    subjectIndex: 0,
    subjectName: '',
    bookIndex: 0,
    bookName: '',
    lastChapter: null
  };
  
  // Find the last class with content
  for (let ci = checkpoint.length - 1; ci >= 0; ci--) {
    const classGroup = checkpoint[ci];
    if (classGroup.subjects && classGroup.subjects.length > 0) {
      position.classIndex = ci;
      position.className = classGroup.class;
      
      // Find the last subject with content
      for (let si = classGroup.subjects.length - 1; si >= 0; si--) {
        const subject = classGroup.subjects[si];
        if (subject.books && subject.books.length > 0) {
          position.subjectIndex = si;
          position.subjectName = subject.subject;
          
          // Find the last book with content
          for (let bi = subject.books.length - 1; bi >= 0; bi--) {
            const book = subject.books[bi];
            if (book.chapters && book.chapters.length > 0) {
              position.bookIndex = bi;
              position.bookName = book.title;
              position.lastChapter = book.chapters[book.chapters.length - 1]?.title || null;
              break;
            }
          }
          break;
        }
      }
      break;
    }
  }
  
  if (position.className) {
    resumePosition = position;
    console.log(`🔻 Resume position found: Class ${position.className}, Subject ${position.subjectName}, Book "${position.bookName}"`);
    if (position.lastChapter) {
      console.log(`  Last chapter processed: ${position.lastChapter}`);
    }
  }
}

// Save checkpoint
function saveCheckpoint(data: ClassGroup[]): void {
  try {
    writeFileSync('./checkpoint.json', JSON.stringify(data, null, 2));
    console.log('💾 Checkpoint saved');
  } catch (error) {
    console.error('Error saving checkpoint:', error);
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',            // container-friendly
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // avoid Chrome tmpfs crashes
    ],
    executablePath:
      "/Users/abhinav/.cache/puppeteer/chrome/mac-138.0.7204.94/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });

  const page = await browser.newPage();
  await page.goto("https://ncert.nic.in/textbook.php", {
    waitUntil: "domcontentloaded",
  });

  // Load existing checkpoint data or start fresh
  const finalResult: ClassGroup[] = loadCheckpoint();
  
  // Create a deep clone of the checkpoint for comparison later
  const initialCheckpoint = JSON.parse(JSON.stringify(finalResult));

  const classOptions = await page.$$eval('select[name="tclass"] option', (options) =>
    options
      .filter((opt) => opt.value !== "-1")
      .map((opt) => ({ value: opt.value, label: opt.textContent?.trim() || "" }))
  );
  
  // If we have a resume position, start from there
  let startFromClass = 0;
  if (resumePosition) {
    // Find the index in classOptions that corresponds to our resume position
    startFromClass = classOptions.findIndex(c => c.label === resumePosition.className);
    if (startFromClass === -1) startFromClass = 0; // If not found, start from beginning
    
    console.log(`🔻 Starting from class ${classOptions[startFromClass].label}`);
  }
  
  for (let ci = startFromClass; ci < classOptions.length; ci++) {
    const cls = classOptions[ci];
    // Log if this class exists in the checkpoint but we'll still check its subjects
    const isClassInCheckpoint = finalResult.some(c => c.class === cls.label);
    if (isClassInCheckpoint) {
      console.log(`\n🧾 Class: ${cls.label} (checking for incomplete subjects)`);
    } else {
      console.log(`\n🧾 Class: ${cls.label} (new class)`);
    }
    await page.select('select[name="tclass"]', cls.value);
    await setTimeout(1000);

    const subjectOptions = await page.$$eval('select[name="tsubject"] option', (options) =>
      options
        .filter((opt) => opt.value !== "-1" && opt.textContent?.trim())
        .map((opt) => opt.textContent?.trim() || "")
    );

    // Find or create the class entry in the result
    let classEntry = finalResult.find(c => c.class === cls.label);
    if (!classEntry) {
      classEntry = { class: cls.label, subjects: [] };
      finalResult.push(classEntry);
    }
    
    // We don't want to skip any subjects - we'll check individual books and chapters
    // to determine what's been fully processed

    for (const subject of subjectOptions) {
      // Check if we should skip to a specific subject based on resume position
      if (resumePosition && cls.label === resumePosition.className) {
        // If we're in the resume class and this subject is before our target subject, skip it
        const subjectOptions = await page.$$eval('select[name="tsubject"] option', (options) =>
          options
            .filter((opt) => opt.value !== "-1" && opt.textContent?.trim())
            .map((opt) => opt.textContent?.trim() || "")
        );
        
        // If we're supposed to resume from a later subject, skip this one
        const subjectIndex = subjectOptions.indexOf(subject);
        const shouldSkipToLaterSubject = subjectIndex < subjectOptions.indexOf(resumePosition.subjectName);
        
        if (shouldSkipToLaterSubject) {
          console.log(`\n📚 Subject: ${subject} (skipping to reach resume point)`);
          continue;
        }
      }
      
      console.log(`\n📚 Subject: ${subject}`);
      await page.select('select[name="tsubject"]', subject);
      await setTimeout(1000);

      const bookOptions = await page.$$eval('select[name="tbook"] option', (options) =>
        options
          .filter((opt) => opt.value !== "-1" && opt.textContent?.trim())
          .map((opt) => ({
            label: opt.textContent?.trim() || "",
            value: opt.getAttribute("value") || "",
          }))
      );

      // Find or create the subject entry
      let subjectEntry = classEntry.subjects.find(s => s.subject === subject);
      if (!subjectEntry) {
        subjectEntry = { subject, books: [] };
        classEntry.subjects.push(subjectEntry);
      }
      
      // Get book options from the page
      const bookOptionValues = new Map(bookOptions.map(b => [b.label, b.value]));
      
      // Track which books need to be processed and which chapters are already completed
      const completedChaptersByBook = new Map<string, Set<string>>();
      
      // Analyze the existing checkpoint data to find which chapters are already processed
      if (subjectEntry.books && subjectEntry.books.length > 0) {
        for (const book of subjectEntry.books) {
          if (book.chapters && book.chapters.length > 0) {
            const completedChapters = new Set<string>();
            book.chapters.forEach(chapter => completedChapters.add(chapter.title));
            completedChaptersByBook.set(book.title, completedChapters);
          }
        }
      }

      // If we're in the resume class and subject, we might need to skip to a specific book
      let startFromBook = 0;
      let shouldSkipToResumeBook = false;
      
      if (resumePosition && 
          cls.label === resumePosition.className && 
          subject === resumePosition.subjectName) {
        // Find the index of the resume book in the current books list
        startFromBook = bookOptions.findIndex(b => b.label === resumePosition.bookName);
        if (startFromBook === -1) startFromBook = 0;
        shouldSkipToResumeBook = true;
        console.log(`\n🔻 Resuming from book: ${resumePosition.bookName}`);
      }
      
      for (let bi = shouldSkipToResumeBook ? startFromBook : 0; bi < bookOptions.length; bi++) {
        const book = bookOptions[bi];
        // Don't skip books entirely - we'll process them and check individual chapters
        // This allows us to resume exactly where we left off
        
        console.log(`\n📘 Book: ${book.label}`);

        await page.select('select[name="tbook"]', book.value);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.click('input[name="button"]'),
        ]);

        // Find or create the book entry
        let bookEntry = subjectEntry.books.find(b => b.title === book.label);
        if (!bookEntry) {
          bookEntry = { title: book.label, chapters: [] };
          subjectEntry.books.push(bookEntry);
        }
        
        const coverImage = await page
          .$eval("iframe[src$='.jpg']", (iframe) => {
            const src = iframe.getAttribute("src");
            return src ? new URL(src, "https://ncert.nic.in/textbook/").href : null;
          })
          .catch(() => null);

        if (coverImage) {
          console.log(`🖼️ Cover: ${coverImage}`);
          bookEntry.coverUrl = coverImage;
          // Save checkpoint after updating cover image
          saveCheckpoint(finalResult);
        }

        // Get the set of completed chapters for this book, or create a new empty set
        const completedChapters = completedChaptersByBook.get(book.label) || new Set<string>();

        const chapterLinks = await page.$$eval('td.sidebar-menu table', (tables) =>
          tables
            .map((table) => {
              const span = table.querySelector("span.sty1");
              const anchor = table.querySelector("a");
              const name = span?.textContent?.trim();
              const href = anchor?.getAttribute("href");

              if (name && href) {
                const fullUrl = href.startsWith("http")
                  ? href
                  : new URL(href, "https://ncert.nic.in/").href;
                return { name, url: fullUrl };
              }
              return null;
            })
            .filter((item): item is { name: string; url: string } => !!item)
        );

        let startFromChapterIndex = 0;
        let foundResumeChapter = false;
        
        // Check if we need to find a specific chapter to resume from
        if (resumePosition && resumePosition.lastChapter && 
            cls.label === resumePosition.className && 
            subject === resumePosition.subjectName && 
            book.label === resumePosition.bookName) {
            
          // Find the chapter after the last one processed
          const lastChapterIndex = chapterLinks.findIndex(c => c.name === resumePosition.lastChapter);
          if (lastChapterIndex !== -1) {
            startFromChapterIndex = lastChapterIndex + 1; // Start from the NEXT chapter
            foundResumeChapter = true;
            if (startFromChapterIndex < chapterLinks.length) {
              console.log(`\n🔻 Resuming after chapter: ${resumePosition.lastChapter}`);
            }
          }
        }
        
        // Reset resumePosition after we've found our place to prevent affecting future iterations
        if (foundResumeChapter) {
          resumePosition = null;
        }
        
        for (let ci = startFromChapterIndex; ci < chapterLinks.length; ci++) {
          const chapter = chapterLinks[ci];
          // Skip if chapter is already processed
          if (completedChapters.has(chapter.name)) {
            console.log(`   📄 ${chapter.name}: (already processed - skipping)`);
            continue;
          }
          
          await page.goto(chapter.url, { waitUntil: "domcontentloaded" });

          const pdfUrl = await page
            .$eval("iframe#myFrame", (iframe) => {
              const src = iframe.getAttribute("src");
              return src ? new URL(src, "https://ncert.nic.in/textbook/").href : null;
            })
            .catch(() => null);

          if (pdfUrl) {
            console.log(`   📄 ${chapter.name}: ${pdfUrl}`);
            // Add chapter to the book's chapters list
            bookEntry.chapters.push({ title: chapter.name, pdfUrl });
            
            // Save checkpoint after each chapter
            saveCheckpoint(finalResult);
          } else {
            console.warn(`   ⚠️ ${chapter.name}: PDF iframe not found — Skipped`);
          }
        }

        // No need to push the book here as we've already created and updated it

        // Go back and reset dropdowns
        await page.goto("https://ncert.nic.in/textbook.php", {
          waitUntil: "domcontentloaded",
        });

        await page.select('select[name="tclass"]', cls.value);
        await setTimeout(1000);
        await page.select('select[name="tsubject"]', subject);
        await setTimeout(1000);
      }

    }
    // No need to push subjects or class here as we've already created and updated them
  }

  await browser.close();

  // Save the final result to both the checkpoint and the output file
  saveCheckpoint(finalResult);
  writeFileSync("ncert_books_nested.json", JSON.stringify(finalResult, null, 2));
  console.log("\n✅ Done. Saved as ncert_books_nested.json and checkpoint.json");
})();