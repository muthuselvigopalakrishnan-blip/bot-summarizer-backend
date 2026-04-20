import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.FRESHSERVICE_DOMAIN;
const FS_API_KEY = process.env.FRESHSERVICE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function authHeader() {
  const token = Buffer.from(`${FS_API_KEY}:X`).toString("base64");
  return `Basic ${token}`;
}

function cleanText(text = "") {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getTicket(ticketId) {
  const ticketRes = await axios.get(
    `https://${DOMAIN}/api/v2/tickets/${ticketId}`,
    {
      headers: {
        Authorization: authHeader(),
      },
    },
  );

  let conversations = [];
  try {
    const convoRes = await axios.get(
      `https://${DOMAIN}/api/v2/tickets/${ticketId}/conversations`,
      {
        headers: {
          Authorization: authHeader(),
        },
      },
    );
    conversations = convoRes.data.conversations || [];
  } catch (error) {
    conversations = [];
  }

  return {
    ...(ticketRes.data.ticket || ticketRes.data),
    recent_conversations: conversations.slice(0, 3),
  };
}

function buildTicketText(ticket) {
  const conversationText = (ticket.recent_conversations || [])
    .map((c, i) => {
      return `Conversation ${i + 1}
Type: ${c.private ? "Private note" : "Reply"}
Text: ${cleanText(c.body_text || c.body || "")}`;
    })
    .join("\n\n");

  return `
Ticket ID: ${ticket.id || "Not specified"}
Subject: ${ticket.subject || "Not specified"}
Description: ${cleanText(ticket.description_text || ticket.description || "") || "Not specified"}
Status: ${ticket.status || "Not specified"}
Priority: ${ticket.priority || "Not specified"}
Requester ID: ${ticket.requester_id || "Not specified"}
Agent ID: ${ticket.responder_id || "Not specified"}

${conversationText || "No conversations found."}
  `.trim();
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/summarize-ticket", async (req, res) => {
  try {
    const ticketId = req.query.ticket_id;
    if (!ticketId) {
      return res.status(400).json({ error: "ticket_id is required" });
    }

    const ticket = await getTicket(ticketId);
    const ticketText = buildTicketText(ticket);

    const prompt = `
Summarize this support ticket in this format:

1. Issue
2. Current status
3. Important details
4. Next action

Do not invent information.
If something is missing, say "Not specified".

${ticketText}
    `.trim();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      ticket_id: ticketId,
      summary: response.text || "No summary generated",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to summarize ticket",
      details: error.response?.data || error.message,
    });
  }
});

app.post("/ask", async (req, res) => {
  try {
    const { ticket_id, question } = req.body;

    if (!ticket_id || !question) {
      return res.status(400).json({
        error: "ticket_id and question are required",
      });
    }

    const ticket = await getTicket(ticket_id);
    const ticketText = buildTicketText(ticket);

    const prompt = `
Answer only from the ticket details below.
If the answer is not in the ticket, say "Not found in ticket."

Ticket details:
${ticketText}

Question:
${question}
    `.trim();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      answer: response.text || "No answer generated",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to answer question",
      details: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
