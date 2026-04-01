#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// Configuration settings
const CONFIG = {
  booksJsonPath: './books.json',
  outputDir: './downloads',
  retryCount: 3,
  retryDelay: 2000, // 2 seconds
  skipExisting: true,
  updateBooksJson: true,
  downloadDelay: 1000, // 1 second delay between downloads
  keepChapters: true, // Keep chapters in books.json after download
  addPathInfo: true, // Add path info to chapters after download
};

// Statistics tracking
const stats = {
  totalClasses: 0,
  totalSubjects: 0,
  totalBooks: 0,
  totalChapters: 0,
  downloadedFiles: 0,
  skippedFiles: 0,
  failedFiles: 0,
};

// Main function
async function main() {
  console.log('🚀 NCERT PDF Downloader');
  console.log(`📂 Output directory: ${CONFIG.outputDir}`);
  console.log('📚 Reading books.json...');

  try {
    // Read books.json file
    const data = readFileSync(CONFIG.booksJsonPath, 'utf8');
    const classes = JSON.parse(data);
    stats.totalClasses = classes.length;
    
    console.log(`📊 Found ${stats.totalClasses} classes in books.json`);
    
    // Remove duplicate chapters before starting download
    removeDuplicateChapters(classes);
    
    // Ensure output directory exists
    if (!existsSync(CONFIG.outputDir)) {
      mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    
    // Process each class
    for (const classGroup of classes) {
      const className = classGroup.class;
      console.log(`\n📘 Processing class: ${className}`);
      
      // Create class directory if it doesn't exist
      const classDir = `${CONFIG.outputDir}/${className}`;
      if (!existsSync(classDir)) {
        mkdirSync(classDir, { recursive: true });
      }
      
      // Process each subject in the class
      stats.totalSubjects += classGroup.subjects.length;
      for (const subject of classGroup.subjects) {
        const subjectName = sanitizeFileName(subject.subject);
        console.log(`📕 Processing subject: ${subjectName}`);
        
        // Create subject directory if it doesn't exist
        const subjectDir = `${classDir}/${subjectName}`;
        if (!existsSync(subjectDir)) {
          mkdirSync(subjectDir, { recursive: true });
        }
        
        // Process each book in the subject
        stats.totalBooks += subject.books.length;
        for (const book of subject.books) {
          const bookName = sanitizeFileName(book.title);
          console.log(`📙 Processing book: ${bookName}`);
          
          // Create book directory if it doesn't exist
          const bookDir = `${subjectDir}/${bookName}`;
          if (!existsSync(bookDir)) {
            mkdirSync(bookDir, { recursive: true });
          }
          
          // Download cover image if available
          if (book.coverUrl) {
            const coverFileName = book.coverUrl.split('/').pop() || 'cover.jpg';
            const relativePath = `${className}/${subjectName}/${bookName}`;
            const coverPath = `${CONFIG.outputDir}/${relativePath}/${coverFileName}`;
            
            // Skip if already marked as downloaded via coverPath property
            if (book.coverPath && CONFIG.skipExisting) {
              console.log(`⏩ Already processed cover: ${coverPath}`);
              stats.skippedFiles++;
            } else {
              const coverSuccess = await downloadFile(book.coverUrl, coverPath);
              // Add delay to avoid overwhelming the server
              await new Promise(resolve => setTimeout(resolve, CONFIG.downloadDelay));
              
              if (coverSuccess && CONFIG.addPathInfo) {
                // Add cover path information instead of removing URL
                book.coverFileName = coverFileName;
                book.coverPath = `/${relativePath}/${coverFileName}`;
                // Update books.json
                updateBooksJson(classes);
              }
            }
          }
          
          // Iterate through chapters and download each one
          stats.totalChapters += book.chapters.length;
          for (let i = 0; i < book.chapters.length; i++) {
            const chapter = book.chapters[i];
            const pdfFileName = chapter.pdfUrl.split('/').pop() || sanitizeFileName(`${chapter.title}.pdf`);
            const relativePath = `${className}/${subjectName}/${bookName}`;
            const pdfPath = `${CONFIG.outputDir}/${relativePath}/${pdfFileName}`;
            
            // Skip if already marked as downloaded
            if (chapter.downloaded && CONFIG.skipExisting) {
              console.log(`⏩ Already processed: ${chapter.title}`);
              stats.skippedFiles++;
              continue;
            }
            
            console.log(`📄 Downloading: ${chapter.title} (${i + 1}/${book.chapters.length})`);
            const success = await downloadFile(chapter.pdfUrl, pdfPath);
            
            // Add delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, CONFIG.downloadDelay));
            
            if (success) {
              stats.downloadedFiles++;
              if (CONFIG.updateBooksJson) {
                if (CONFIG.addPathInfo) {
                  // Add path info to chapter
                  chapter.fileName = pdfFileName;
                  chapter.path = `/${relativePath}`;
                  chapter.downloaded = true;
                }
                if (!CONFIG.keepChapters) {
                  // Remove chapter from book
                  book.chapters.splice(i, 1);
                  i--; // Adjust index after removal
                }
                updateBooksJson(classes);
              }
            } else {
              stats.failedFiles++;
            }
          }
        }
      }
    }
    
    // Print statistics
    console.log('\n✅ Download completed!');
    console.log('📊 Statistics:');
    console.log(`- Total Classes: ${stats.totalClasses}`);
    console.log(`- Total Subjects: ${stats.totalSubjects}`);
    console.log(`- Total Books: ${stats.totalBooks}`);
    console.log(`- Total Chapters: ${stats.totalChapters}`);
    console.log(`- Downloaded: ${stats.downloadedFiles}`);
    console.log(`- Skipped: ${stats.skippedFiles}`);
    console.log(`- Failed: ${stats.failedFiles}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Function to update books.json file
function updateBooksJson(classes) {
  if (CONFIG.updateBooksJson) {
    try {
      writeFileSync(CONFIG.booksJsonPath, JSON.stringify(classes, null, 2));
    } catch (error) {
      console.error('❌ Error updating books.json:', error.message);
    }
  }
}

// Function to download a file from URL
async function downloadFile(url, outputPath) {
  // Skip if file already exists and skip option is enabled
  if (existsSync(outputPath) && CONFIG.skipExisting) {
    console.log(`⏩ File already exists: ${outputPath}`);
    return true;
  }
  
  // Create directory if it doesn't exist
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  // Try to download the file with retries
  let retries = 0;
  while (retries <= CONFIG.retryCount) {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      writeFileSync(outputPath, Buffer.from(buffer));
      console.log(`✅ Successfully downloaded to ${outputPath}`);
      return true;
    } catch (error) {
      retries++;
      if (retries > CONFIG.retryCount) {
        console.error(`❌ Failed to download ${url} after ${CONFIG.retryCount} retries: ${error.message}`);
        return false;
      }
      console.log(`⚠️ Retry ${retries}/${CONFIG.retryCount} for ${url}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
    }
  }
  
  return false;
}

// Function to sanitize file names
function sanitizeFileName(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, '-') // Replace invalid characters with dash
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim(); // Trim leading and trailing spaces
}

// Function to remove duplicate chapters based on title and pdfUrl
function removeDuplicateChapters(classes) {
  let totalDuplicates = 0;
  
  for (const classGroup of classes) {
    for (const subject of classGroup.subjects) {
      for (const book of subject.books) {
        // Use a Map to detect duplicates by URL
        const uniqueChapters = new Map();
        const uniqueArray = [];
        
        for (const chapter of book.chapters) {
          // Create a key using title and URL
          const key = `${chapter.title}-${chapter.pdfUrl}`;
          
          if (!uniqueChapters.has(key)) {
            uniqueChapters.set(key, chapter);
            uniqueArray.push(chapter);
          } else {
            totalDuplicates++;
          }
        }
        
        // Replace chapters array with deduplicated array
        if (book.chapters.length !== uniqueArray.length) {
          const removedCount = book.chapters.length - uniqueArray.length;
          console.log(`🔄 Removed ${removedCount} duplicate chapter(s) from "${book.title}"`);
          book.chapters = uniqueArray;
        }
      }
    }
  }
  
  if (totalDuplicates > 0) {
    console.log(`🧹 Removed ${totalDuplicates} duplicate chapters in total`);
    updateBooksJson(classes);
  } else {
    console.log('✓ No duplicate chapters found');
  }
}

// Run the main function
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
