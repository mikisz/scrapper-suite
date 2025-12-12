const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const archiver = require('archiver');

puppeteer.use(StealthPlugin());

async function scrapeProfile(username) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Create page once
  const page = await browser.newPage();

  try {
    // Set a realistic viewport
    await page.setViewport({ width: 1366, height: 768 });

    console.log(`Navigating to https://dribbble.com/${username}`);
    await page.goto(`https://dribbble.com/${username}`, { waitUntil: 'networkidle2', timeout: 60000 });

    // Check if user exists
    const isError = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return document.querySelector('.error-container') || (h1 && h1.innerText === 'Whoops, that page is gone.');
    });

    if (isError) {
      throw new Error('User not found');
    }

    // Auto-scroll to load shots
    console.log('Scrolling to load shots...');
    await autoScroll(page);

    // Collect shot links
    const shotLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a.shot-thumbnail-link'));
      return links.map(link => link.href);
    });

    console.log(`Found ${shotLinks.length} shots.`);

    // Limit to 50 for performance
    const linksToScrape = shotLinks.slice(0, 50);

    const downloadDir = path.join(__dirname, 'downloads', username);
    await fs.ensureDir(downloadDir);

    console.log(`Scraping ${linksToScrape.length} shots...`);

    // Iterate using the same page
    for (let i = 0; i < linksToScrape.length; i++) {
      const link = linksToScrape[i];
      try {
        console.log(`Navigating to shot ${i + 1}/${linksToScrape.length}`);

        // Random delay
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Find image
        const imageUrl = await page.evaluate(() => {
          // Strategy 1: High res userupload link
          const highResLink = document.querySelector('a[href^="https://cdn.dribbble.com/userupload/"]');
          if (highResLink) return highResLink.href;

          // Strategy 2: Media item img
          const mediaImg = document.querySelector('.media-item img');
          if (mediaImg) return mediaImg.src;

          // Strategy 3: Video?
          const video = document.querySelector('video source');
          if (video) return video.src;

          return null;
        });

        if (imageUrl) {
          const cleanUrl = imageUrl.split('?')[0];
          const ext = path.extname(cleanUrl) || '.jpg';
          const filename = `${username}_shot_${i + 1}${ext}`;
          const filePath = path.join(downloadDir, filename);

          await downloadImage(cleanUrl, filePath);
          console.log(`Downloaded: ${filename}`);
        } else {
          console.log(`No image found for ${link}.`);
          // Save debug info for the first failure only to avoid disk spam
          if (i === 0) {
            await page.screenshot({ path: path.join(downloadDir, 'debug_fail.png') });
            const html = await page.content();
            await fs.writeFile(path.join(downloadDir, 'debug_fail.html'), html);
          }
        }

      } catch (err) {
        console.error(`Failed to scrape shot ${link}:`, err.message);
      }
    }

    await browser.close();

    // Zip
    console.log('Zipping images...');
    const zipPath = path.join(__dirname, 'downloads', `${username}.zip`);
    await zipDirectory(downloadDir, zipPath);

    // Cleanup
    await fs.remove(downloadDir);

    return zipPath;

  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight || totalHeight > 20000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', err => {
      fs.unlink(filepath);
      reject(err);
    });
  });
}

function zipDirectory(sourceDir, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', err => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

module.exports = { scrapeProfile };
