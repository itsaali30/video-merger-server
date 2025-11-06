const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

// IMPORTANT for TERMUX
ffmpeg.setFfmpegPath("/data/data/com.termux/files/usr/bin/ffmpeg");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/merge", express.static(path.join(__dirname, "merge")));

if (!fs.existsSync("./merge")) fs.mkdirSync("./merge");

function getResolution(device) {
  switch (device) {
    case "mp": return "720x1280";     // Mobile Portrait
    case "ml": return "1280x720";     // Mobile Landscape
    case "pc": return "1920x1080";    // Desktop / Laptop
    default:   return "1280x720";
  }
}

// ---------------- VIDEO MERGE ----------------
app.post("/vdo/merge", async (req, res) => {
  try {
    const { filename, inputvdo, inputaud, inputbgm, subtitle, device } = req.body;

    const resolution = getResolution(device);
    const output = `./merge/${filename}`;

    // Create temporary concat list
    const listFile = "./video_list.txt";
    fs.writeFileSync(listFile, inputvdo.map(v => `file '${v}'`).join("\n"));

    const tempOutput = "./merge/tmp.mp4";

    // Step 1 = merge videos
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listFile)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .save(tempOutput)
        .on("end", resolve)
        .on("error", reject);
    });

    // Step 2 = add audio (main 100% + bgm 10%) + subtitles + scaling
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(tempOutput)
        .input(inputaud);

      // Add background music if provided
      if (inputbgm) {
        cmd.input(inputbgm);
      }

      const videoFilters = [
        `scale=${resolution}`,
        subtitle ? `subtitles='${subtitle}':force_style='FontSize=32,Outline=1,Shadow=1'` : null
      ].filter(Boolean);

      // Audio filter: main audio at 100%, bgm at 10%, then mix
      const audioFilter = inputbgm 
        ? "[1:a]volume=1.0[a1];[2:a]volume=0.1[a2];[a1][a2]amix=inputs=2:duration=shortest[aout]"
        : "[1:a]volume=1.0[aout]";

      cmd
        .videoFilters(videoFilters)
        .complexFilter(audioFilter)
        .outputOptions([
          "-map", "0:v",           // Map video from merged video
          "-map", "[aout]",        // Map mixed audio
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "22",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest"
        ])
        .save(output)
        .on("end", resolve)
        .on("error", reject);
    });

    fs.unlinkSync(listFile);
    fs.unlinkSync(tempOutput);

    ffmpeg.ffprobe(output, (err, data) => {
      return res.json({
        status: "success",
        file: filename,
        url: `http://localhost:3000/merge/${filename}`,
        duration: data.format.duration
      });
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- IMAGE / SLIDESHOW MERGE ----------------
app.post("/img/merge", async (req, res) => {
  try {
    const { filename, inputvdo, inputaud, inputbgm, subtitle, device } = req.body;

    const resolution = getResolution(device);
    const output = `./merge/${filename}`;

    let cmd = ffmpeg();
    inputvdo.forEach(img => cmd.input(img));
    cmd.input(inputaud);

    // Add background music if provided
    if (inputbgm) {
      cmd.input(inputbgm);
    }

    const videoFilters = [
      `scale=${resolution}`,
      subtitle ? `subtitles='${subtitle}':force_style='FontSize=32,Outline=1,Shadow=1'` : null
    ].filter(Boolean);

    // Audio filter for images: main audio at 100%, bgm at 10%
    const audioInputIndex = inputvdo.length;
    const bgmInputIndex = inputvdo.length + 1;
    
    const audioFilter = inputbgm
      ? `[${audioInputIndex}:a]volume=1.0[a1];[${bgmInputIndex}:a]volume=0.1[a2];[a1][a2]amix=inputs=2:duration=shortest[aout]`
      : `[${audioInputIndex}:a]volume=1.0[aout]`;

    cmd
      .videoFilters(videoFilters)
      .complexFilter(audioFilter)
      .outputOptions([
        "-map", "0:v",           // Map video from images
        "-map", "[aout]",        // Map mixed audio
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest"
      ])
      .save(output)
      .on("end", () => {
        ffmpeg.ffprobe(output, (err, data) => {
          return res.json({
            status: "success",
            file: filename,
            url: `http://localhost:3000/merge/${filename}`,
            duration: data.format.duration
          });
        });
      })
      .on("error", err => res.status(500).json({ error: err.message }));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("✅ Server running on port 3000"));
