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
    removeFiles: false, // Set to false to keep chapters in books.json after download
};
// Stats tracking
const stats = {
    totalFiles: 0,
    downloadedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
};
// Helper to ensure directory exists
function ensureDirExists(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
// Helper to sanitize filenames
function sanitizeFileName(name) {
    return name.replace(/[\/:*?"<>|]/g, '_');
}
// Function to download a single file
async function downloadFile(url, outputPath) {
    if (CONFIG.skipExisting && existsSync(outputPath)) {
        console.log(`✅ Skipped (already exists): ${outputPath}`);
        stats.skippedFiles++;
        return true;
    }
    let attempts = 0;
    while (attempts < CONFIG.retryCount) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
            }
            const buffer = await response.arrayBuffer();
            ensureDirExists(outputPath);
            writeFileSync(outputPath, Buffer.from(buffer));
            console.log(`✅ Downloaded: ${outputPath}`);
            stats.downloadedFiles++;
            return true;
        }
        catch (error) {
            attempts++;
            console.error(`❌ Attempt ${attempts}/${CONFIG.retryCount} failed for ${url}: ${error.message}`);
            if (attempts < CONFIG.retryCount) {
                console.log(`   Retrying in ${CONFIG.retryDelay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
            }
        }
    }
    console.error(`❌ Failed to download after ${CONFIG.retryCount} attempts: ${url}`);
    stats.failedFiles++;
    return false;
}
// Function to remove duplicate chapters in books data
function removeDuplicateChapters(classes) {
    console.log('🔍 Checking for duplicate chapters...');
    let dupeCount = 0;
    for (const cls of classes) {
        for (const subject of cls.subjects) {
            for (const book of subject.books) {
                const uniqueChapters = [];
                const seen = new Set();
                for (const chapter of book.chapters) {
                    // Create a unique key for each chapter
                    const key = `${chapter.title}|${chapter.pdfUrl}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueChapters.push(chapter);
                    }
                    else {
                        dupeCount++;
                    }
                }
                // Replace chapters with unique chapters
                book.chapters = uniqueChapters;
            }
        }
    }
    if (dupeCount > 0) {
        console.log(`✂️  Removed ${dupeCount} duplicate chapters.`);
    }
    else {
        console.log('✅ No duplicate chapters found.');
    }
    return classes;
}
// Function to update books.json file
function updateBooksJson(classes) {
    if (!CONFIG.updateJson)
        return;
    try {
        writeFileSync(CONFIG.booksJsonPath, JSON.stringify(classes, null, 2));
        console.log(`📝 Updated ${CONFIG.booksJsonPath}`);
    }
    catch (error) {
        console.error(`❌ Failed to update ${CONFIG.booksJsonPath}:`, error.message);
    }
}
// Main download function
async function downloadAllBooks() {
    try {
        console.log('📚 Loading books.json file...');
        const booksData = readFileSync(CONFIG.booksJsonPath, 'utf-8');
        let classes = JSON.parse(booksData);
        // Remove duplicate chapters
        classes = removeDuplicateChapters(classes);
        updateBooksJson(classes); // Save the deduped version
        // Count total files to download
        for (const cls of classes) {
            for (const subject of cls.subjects) {
                for (const book of subject.books) {
                    if (book.coverUrl)
                        stats.totalFiles++;
                    stats.totalFiles += book.chapters.length;
                }
            }
        }
        console.log(`🔍 Found ${stats.totalFiles} files to process.\n`);
        // Process each class
        for (const cls of classes) {
            const className = sanitizeFileName(cls.class);
            console.log(`\n📂 Processing ${cls.class}`);
            // Process each subject
            for (const subject of cls.subjects) {
                const subjectName = sanitizeFileName(subject.subject);
                console.log(`  📂 Subject: ${subject.subject}`);
                // Process each book
                for (const book of subject.books) {
                    const bookName = sanitizeFileName(book.title);
                    console.log(`    📖 Book: ${book.title}`);
                    // Download cover image if available
                    if (book.coverUrl) {
                        const coverFileName = book.coverUrl.split('/').pop() || 'cover.jpg';
                        const relativePath = `${className}/${subjectName}/${bookName}`;
                        const coverPath = `${CONFIG.outputDir}/${relativePath}/cover.jpg`;
                        // Skip if already marked as downloaded via coverPath property
                        if (book.coverPath && CONFIG.skipExisting) {
                            console.log(`⏩ Already processed cover: ${coverPath}`);
                            stats.skippedFiles++;
                        }
                        else {
                            const coverSuccess = await downloadFile(book.coverUrl, coverPath);
                            // Add delay to avoid overwhelming the server
                            await new Promise(resolve => setTimeout(resolve, CONFIG.downloadDelay));
                            if (coverSuccess && CONFIG.addPathInfo) {
                                // Add cover path information instead of removing URL
                                book.coverFileName = coverFileName;
                                book.coverPath = `/${relativePath}/cover.jpg`;
                                // Update books.json
                                updateBooksJson(classes);
                            }
                        }
                    }
                    // Iterate through chapters and download each one
                    for (let i = 0; i < book.chapters.length; i++) {
                        const chapter = book.chapters[i];
                        const pdfFileName = chapter.pdfUrl.split('/').pop() || sanitizeFileName(`${chapter.title}.pdf`);
                        const relativePath = `${className}/${subjectName}/${bookName}`;
                        const pdfPath = `${CONFIG.outputDir}/${relativePath}/${pdfFileName}`;
                        // Skip if already marked as downloaded
                        if (chapter.downloaded && CONFIG.skipExisting) {
                            console.log(`⏩ Already processed: ${pdfPath}`);
                            stats.skippedFiles++;
                            continue;
                        }
                        const success = await downloadFile(chapter.pdfUrl, pdfPath);
                        if (success) {
                            // Instead of removing, mark as downloaded and add path info
                            if (CONFIG.addPathInfo) {
                                chapter.fileName = pdfFileName;
                                chapter.path = `/${relativePath}`;
                                chapter.downloaded = true;
                            }
                            // Update books.json after each successful download
                            updateBooksJson(classes);
                        }
                        // Add delay to avoid overwhelming the server
                        await new Promise(resolve => setTimeout(resolve, CONFIG.downloadDelay));
                    }
                }
            }
        }
        console.log('\n\n📊 Download Summary:');
        console.log(`Total files: ${stats.totalFiles}`);
        console.log(`Downloaded: ${stats.downloadedFiles}`);
        console.log(`Skipped: ${stats.skippedFiles}`);
        console.log(`Failed: ${stats.failedFiles}`);
        console.log('\n✅ Download process completed!');
    }
    catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}
// Create output directory if it doesn't exist
if (!existsSync(CONFIG.outputDir)) {
    mkdirSync(CONFIG.outputDir, { recursive: true });
}
console.log(`🚀 Starting NCERT PDF downloader...\n`);
console.log(`📁 Output directory: ${CONFIG.outputDir}`);
console.log(`📄 Books JSON file: ${CONFIG.booksJsonPath}`);
console.log(`⏱️  Delay between downloads: ${CONFIG.downloadDelay}ms`);
console.log(`🔄 Retry attempts: ${CONFIG.retryCount}`);
console.log(`⏭️  Skip existing files: ${CONFIG.skipExisting ? 'Yes' : 'No'}`);
console.log(`📝 Update books.json after downloads: ${CONFIG.updateJson ? 'Yes' : 'No'}`);
// Start the download process
downloadAllBooks();
