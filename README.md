# MediBuddy 💊 – A Health Companion for Elderly Medication Management

**MediBuddy** is an AI-powered medical assistant tailored for elderly users, especially those managing multiple prescriptions and long-term health conditions.

This project aims to simplify the process of understanding, organizing, and tracking medication and medical records through a user-friendly interface — starting with image uploads of prescriptions or pill bottles.

---

## 🧠 Project Goal

Elderly patients, particularly in Indian households, often have to manage:
- Dozens of medications daily
- Stacks of handwritten or printed prescriptions
- Confusing instructions from doctors and pharmacists

**MediBuddy** addresses this by:
- Letting users upload images of prescriptions or pill bottles 📸
- Using OCR (Tesseract) to extract text from the image
- Identifying the medicine name and providing a clear explanation of:
  - What it is
  - How to take it
  - Common side effects

---

## ✅ Current Features (MVP)

- Upload a medicine image (e.g., pill bottle or printed prescription)
- Extract text using Tesseract OCR
- (In Progress) Use RAG with GPT-4o + medical sources to explain the medicine in simple terms

---

## 🛠️ Tech Stack (Evolving)

| Component | Stack |
|----------|-------|
| OCR | `pytesseract`, `Pillow`, `OpenCV` |
| LLM | `OpenAI GPT-4o API` |
| Retrieval | `LangChain`, `FAISS` |
| Frontend (planned) | Simple web interface (TBD) |
| Scraping source | `drugs.com` or `MedlinePlus` for medicine data |

---

## 📌 Planned Features

- Add long-term health context per user (via login + data history)
- Symptom checker that ties to patient history
- Multilingual or voice assistant support
- Frontend UI for uploads + summaries
- Privacy-safe handling (e.g., automatic PII removal from OCR)

---

## 🚧 Status

> Still in early development. Currently working on:
- Improving OCR reliability
- Building scraping pipeline for medicine information
- Setting up RAG flow using LangChain

---


