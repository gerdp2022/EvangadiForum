// Loads .env before anything else.
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "./schema/db.config.js";
import { mainRouter } from "./src/mainRoutes.js";
import { errorHandler, notFound } from "./src/middleware/error-handler.js";
import { PROFILE_UPLOAD_DIR } from "./src/api/profile/config/profile.upload.config.js";
import { warmQuestionTagEmbeddings } from "./src/api/question/service/question-tagging.service.js";

const app = express();

// Requests reach this app through two proxies: Vercel (the /api rewrite)
// and Render. Trusting both makes req.ip the visitor's real IP instead of
// a proxy's, so the login rate limit counts each visitor separately.
app.set("trust proxy", 2);

// middleware
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(cookieParser());
// app.use(cors());

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: "https://evangadi-forum-frontend-35yt.onrender.com",
    credentials: true,
  }),
);

// Only profile photos are public. Users' PDFs (uploads/rag) are NOT served
// here; they are only reachable through GET /api/rag/documents/:id/file,
// which checks that the document belongs to the logged-in user.
app.use("/uploads/profiles", express.static(PROFILE_UPLOAD_DIR));

//Main api
app.use("/api", mainRouter);

//  your error handler middleware should be after all api calls
app.use(notFound);
app.use(errorHandler);

// connection and server configuration
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    const connection = await db.getConnection();
    connection.release();
    console.log("Connected to database");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error(
      "Database connection failed. Server not started:",
      error.message,
    );
    process.exit(1);
  }
}

warmQuestionTagEmbeddings();
startServer();
