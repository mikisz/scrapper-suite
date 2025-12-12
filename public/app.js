document.addEventListener('DOMContentLoaded', () => {
    const downloadBtn = document.getElementById('downloadBtn');
    const usernameInput = document.getElementById('username');
    const statusDiv = document.getElementById('status');
    const loader = document.querySelector('.loader');

    downloadBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();

        if (!username) {
            statusDiv.textContent = 'Please enter a username.';
            statusDiv.style.color = '#ff4d4d'; // Red
            return;
        }

        // Reset UI
        statusDiv.textContent = 'Starting scraper... This may take a minute.';
        statusDiv.style.color = 'rgba(255, 255, 255, 0.8)';
        downloadBtn.classList.add('loading');
        downloadBtn.disabled = true;

        try {
            // Trigger download
            // We use fetch to handle errors gracefully before just navigating
            const response = await fetch(`/api/scrape?username=${username}`);

            if (response.ok) {
                statusDiv.textContent = 'Downloading zip...';

                // Convert response to blob and download
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `${username}-dribbble-shots.zip`;
                document.body.appendChild(a);
                a.click();

                window.URL.revokeObjectURL(url);
                statusDiv.textContent = 'Done! Check your downloads.';
                statusDiv.style.color = '#4caf50'; // Green
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Scraping failed');
            }

        } catch (error) {
            console.error(error);
            statusDiv.textContent = `Error: ${error.message}`;
            statusDiv.style.color = '#ff4d4d';
        } finally {
            downloadBtn.classList.remove('loading');
            downloadBtn.disabled = false;
        }
    });

    // Allow Enter key to submit
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            downloadBtn.click();
        }
    });
});
