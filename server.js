const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeProfile } = require('./scraper');
const fs = require('fs-extra');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/scrape', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        console.log(`Received request to scrape: ${username}`);

        // Increase timeout for this specific request if possible, 
        // essentially by just not sending a response until done.
        // Node default timeout is 2 minutes, which might be tight for 50 shots.
        // But for a simple local app, let's try.

        const zipPath = await scrapeProfile(username);

        res.download(zipPath, `${username}-dribbble-shots.zip`, async (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            // Cleanup zip file after sending
            try {
                await fs.remove(zipPath);
                console.log('Cleaned up zip file.');
            } catch (cleanupErr) {
                console.error('Error cleaning up:', cleanupErr);
            }
        });

    } catch (error) {
        console.error('Scraping failed:', error);
        res.status(500).json({ error: error.message || 'Failed to scrape profile' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
