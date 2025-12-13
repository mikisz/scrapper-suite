document.getElementById('scanBtn').addEventListener('click', async () => {
    const btn = document.getElementById('scanBtn');
    const status = document.getElementById('status');
    const textarea = document.getElementById('result');

    btn.disabled = true;
    status.textContent = 'Injecting script...';
    textarea.style.display = 'none';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
        // Inject the shared serializer first
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['lib/dom-serializer.js']
        });

        // Inject the content script wrapper
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        // Send message to content script to start scan
        status.textContent = 'Scanning DOM...';

        // We need to wait a bit for the script to be ready or just use executeScript with a function
        // But content.js should listen for a message or run immediately. 
        // Let's use executeScript to trigger the global function directly to be simpler.
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // @ts-ignore
                if (window.FigmaSerializer) {
                    return window.FigmaSerializer.serialize(document.body);
                }
                return null;
            }
        });

        const result = results[0].result;

        if (result) {
            const jsonStr = JSON.stringify({ url: tab.url, data: result });
            textarea.value = jsonStr;
            textarea.style.display = 'block';

            // Use modern Clipboard API instead of deprecated execCommand
            try {
                await navigator.clipboard.writeText(jsonStr);
                status.textContent = 'Done! JSON copied to clipboard.';
            } catch (clipboardErr) {
                // Fallback: select text for manual copy
                textarea.select();
                status.textContent = 'Done! Select and copy the JSON manually.';
                console.warn('Clipboard write failed:', clipboardErr);
            }
        } else {
            status.textContent = 'Error: Serializer failed to return data.';
        }

    } catch (err) {
        status.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
    }
});
