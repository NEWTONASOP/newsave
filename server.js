const express = require("express");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/download", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    const outputPath = path.join(__dirname, "downloads", "%(title)s.%(ext)s");

    exec(`yt-dlp -x --audio-format mp3 -o "${outputPath}" ${url}`, (error, stdout, stderr) => {
        if (error) return res.status(500).json({ error: stderr });

        // Find downloaded file
        const match = stdout.match(/Destination: (.*\.mp3)/);
        if (!match) return res.status(500).json({ error: "Download failed" });

        const filePath = match[1].trim();
        res.json({ message: "Download complete", file: filePath });
    });
});

app.use("/files", express.static(path.join(__dirname, "downloads")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
