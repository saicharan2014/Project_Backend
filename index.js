const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const cors = require("cors");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const stream = require("stream");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*", // Allow frontend access
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

// Configure AWS SDK
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer setup (stores files temporarily in memory)
const upload = multer({ storage: multer.memoryStorage() });

// 📌 BULK FILE UPLOAD TO S3
app.post("/upload", upload.array("files", 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }

  try {
    // Upload each file to S3
    const uploadPromises = req.files.map(async (file) => {
      const fileKey = `uploads/${Date.now()}_${file.originalname}`;

      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      await s3.send(new PutObjectCommand(uploadParams));

      return {
        name: fileKey, // Ensure consistent naming
        url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`,
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    res
      .status(200)
      .json({ message: "Files uploaded successfully", files: uploadedFiles });
  } catch (error) {
    console.error("Upload error:", error);
    res
      .status(500)
      .json({ message: "File upload failed", error: error.message });
  }
});

// 📌 GET LIST OF FILES
app.get("/files", async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
    });
    const { Contents } = await s3.send(command);

    // Ensure safe mapping in case no files exist
    const files = Contents
      ? Contents.map((item) => ({
          name: item.Key.replace("uploads/", ""), // Send clean name
          url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
        }))
      : [];

    res.status(200).json({ files });
  } catch (error) {
    console.error("Fetch error:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch files", error: error.message });
  }
});

// 📌 DELETE A FILE FROM S3
app.delete("/delete/:fileName", async (req, res) => {
  let fileName = req.params.fileName;
  console.log(`Deleting file: ${fileName}`);

  // Ensure file name includes `uploads/` for correct S3 reference
  const fileKey = `uploads/${fileName}`;

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileKey,
      })
    );
    res.status(200).json({ message: `File ${fileName} deleted successfully` });
  } catch (error) {
    console.error("Delete error:", error);
    res
      .status(500)
      .json({ message: "File deletion failed", error: error.message });
  }
});

app.get("/download/:fileName", async (req, res) => {
  const fileName = req.params.fileName;
  const fileKey = `uploads/${fileName}`;

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: fileKey,
    });

    const { Body } = await s3.send(command);

    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.setHeader("Content-Type", "application/octet-stream");

    const passThroughStream = new stream.PassThrough();
    Body.pipe(passThroughStream);
    passThroughStream.pipe(res);
  } catch (error) {
    console.error("Download error:", error);
    res
      .status(500)
      .json({ message: "File download failed", error: error.message });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
