const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use("/merge", express.static(path.join(__dirname, "merge")));

// Create merge directory if it doesn't exist
if (!fs.existsSync("./merge")) {
  fs.mkdirSync("./merge");
  console.log("✅ Created ./merge directory");
}

// Helper function to check if string is a URL
function isURL(str) {
  return /^https?:\/\//i.test(str);
}

// Helper function to validate files (URLs are always considered valid)
function validateFiles(files) {
  const missing = [];
  const fileArray = Array.isArray(files) ? files : [files];
  
  for (const file of fileArray) {
    if (file && !isURL(file) && !fs.existsSync(file)) {
      missing.push(file);
    }
  }
  return missing;
}

function getResolution(device) {
  switch (device) {
    case "mp": return "720x1280";     // Mobile Portrait
    case "ml": return "1280x720";     // Mobile Landscape
    case "pc": return "1920x1080";    // Desktop / Laptop
    default:   return "1280x720";
  }
}

// ---------------- VIDEO MERGE ENDPOINT ----------------
app.post("/vdo/merge", async (req, res) => {
  try {
    const { filename, inputvdo, inputaud, subtitle, device } = req.body;

    if (!filename || !inputvdo || !inputaud) {
      return res.status(400).json({ 
        error: "Missing required fields: filename, inputvdo, inputaud" 
      });
    }

    // Validate that all LOCAL files exist (URLs are skipped)
    const missingVideos = validateFiles(inputvdo);
    const missingAudio = validateFiles(inputaud);
    const missingSubtitle = subtitle ? validateFiles(subtitle) : [];
    
    const allMissing = [...missingVideos, ...missingAudio, ...missingSubtitle];
    
    if (allMissing.length > 0) {
      return res.status(404).json({ 
        error: "Local files not found",
        missing: allMissing,
        note: "URLs are processed directly without validation"
      });
    }

    const resolution = getResolution(device);
    const output = `./merge/${filename}`;
    const listFile = "./video_list.txt";
    const tempOutput = "./merge/tmp.mp4";

    // Create temporary concat list
    // For URLs, use them directly. For local files, use absolute paths
    const processedPaths = inputvdo.map(v => 
      isURL(v) ? v : path.resolve(v)
    );
    fs.writeFileSync(listFile, processedPaths.map(v => `file '${v}'`).join("\n"));

    console.log(`📹 Merging ${inputvdo.length} videos (URLs and/or local files)...`);
    inputvdo.forEach((v, i) => {
      console.log(`   ${i + 1}. ${isURL(v) ? '🌐 URL' : '📁 Local'}: ${v}`);
    });

    // Step 1: Merge videos
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listFile)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .save(tempOutput)
        .on("end", () => {
          console.log("✅ Videos merged");
          resolve();
        })
        .on("error", reject);
    });

    console.log("🎵 Adding audio and processing...");

    // Process audio input (URL or local file)
    const audioInput = isURL(inputaud) ? inputaud : path.resolve(inputaud);
    console.log(`   Audio: ${isURL(inputaud) ? '🌐 URL' : '📁 Local'}: ${inputaud}`);

    // Step 2: Add audio (full volume) + scale + subtitles (video audio muted)
    await new Promise((resolve, reject) => {
      const filters = [
        `scale=${resolution}`,
        subtitle ? `subtitles='${isURL(subtitle) ? subtitle : path.resolve(subtitle)}':force_style='FontSize=32,Outline=1,Shadow=1'` : null
      ].filter(Boolean);

      const cmd = ffmpeg(tempOutput)
        .input(audioInput)
        .videoFilters(filters)
        .outputOptions([
          "-map", "0:v",           // Video from merged file (NO AUDIO)
          "-map", "1:a",           // Audio from audio file (FULL VOLUME)
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "22",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest"
        ])
        .save(output)
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(`   Processing: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          console.log("✅ Final video created");
          resolve();
        })
        .on("error", reject);
    });

    // Cleanup
    fs.unlinkSync(listFile);
    fs.unlinkSync(tempOutput);

    // Get video info
    ffmpeg.ffprobe(output, (err, data) => {
      if (err) {
        return res.status(500).json({ error: "Failed to probe video" });
      }
      
      return res.json({
        status: "success",
        file: filename,
        url: `${req.protocol}://${req.get('host')}/merge/${filename}`,
        duration: data.format.duration,
        resolution: resolution,
        inputs: {
          videos: inputvdo.length,
          audio: isURL(inputaud) ? "URL" : "Local file",
          subtitle: subtitle ? (isURL(subtitle) ? "URL" : "Local file") : "None"
        }
      });
    });

  } catch (err) {
    console.error("❌ Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- IMAGE SLIDESHOW MERGE ENDPOINT ----------------
app.post("/img/merge", async (req, res) => {
  try {
    const { filename, inputvdo, inputaud, subtitle, device } = req.body;

    if (!filename || !inputvdo || !inputaud) {
      return res.status(400).json({ 
        error: "Missing required fields: filename, inputvdo, inputaud" 
      });
    }

    // Validate that all LOCAL files exist (URLs are skipped)
    const missingImages = validateFiles(inputvdo);
    const missingAudio = validateFiles(inputaud);
    const missingSubtitle = subtitle ? validateFiles(subtitle) : [];
    
    const allMissing = [...missingImages, ...missingAudio, ...missingSubtitle];
    
    if (allMissing.length > 0) {
      return res.status(404).json({ 
        error: "Local files not found",
        missing: allMissing,
        note: "URLs are processed directly without validation"
      });
    }

    const resolution = getResolution(device);
    const output = `./merge/${filename}`;

    console.log(`🖼️  Creating slideshow from ${inputvdo.length} images...`);
    inputvdo.forEach((img, i) => {
      console.log(`   ${i + 1}. ${isURL(img) ? '🌐 URL' : '📁 Local'}: ${img}`);
    });

    let cmd = ffmpeg();
    
    // Add each image (URL or local file)
    inputvdo.forEach(img => {
      const input = isURL(img) ? img : path.resolve(img);
      cmd.input(input);
    });
    
    // Add audio (URL or local file)
    const audioInput = isURL(inputaud) ? inputaud : path.resolve(inputaud);
    cmd.input(audioInput);
    console.log(`   Audio: ${isURL(inputaud) ? '🌐 URL' : '📁 Local'}: ${inputaud}`);

    const filters = [
      `scale=${resolution}`,
      subtitle ? `subtitles='${isURL(subtitle) ? subtitle : path.resolve(subtitle)}':force_style='FontSize=32,Outline=1,Shadow=1'` : null
    ].filter(Boolean);

    cmd
      .videoFilters(filters)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest"
      ])
      .on("progress", (progress) => {
        if (progress.percent) {
          console.log(`   Processing: ${Math.round(progress.percent)}%`);
        }
      })
      .save(output)
      .on("end", () => {
        console.log("✅ Slideshow created");
        
        ffmpeg.ffprobe(output, (err, data) => {
          if (err) {
            return res.status(500).json({ error: "Failed to probe video" });
          }
          
          return res.json({
            status: "success",
            file: filename,
            url: `${req.protocol}://${req.get('host')}/merge/${filename}`,
            duration: data.format.duration,
            resolution: resolution,
            inputs: {
              images: inputvdo.length,
              audio: isURL(inputaud) ? "URL" : "Local file",
              subtitle: subtitle ? (isURL(subtitle) ? "URL" : "Local file") : "None"
            }
          });
        });
      })
      .on("error", err => {
        console.error("❌ Error:", err.message);
        res.status(500).json({ error: err.message });
      });

  } catch (err) {
    console.error("❌ Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- HEALTH CHECK ----------------
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Video Merger Server is running",
    timestamp: new Date().toISOString(),
    features: ["Local files", "Remote URLs", "Mixed inputs"]
  });
});

// Start server
app.listen(PORT, () => {
  console.log("=================================");
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📁 Supports: Local files`);
  console.log(`🌐 Supports: Remote URLs`);
  console.log("=================================");
});
