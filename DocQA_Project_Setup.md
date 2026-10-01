# Running the DocQA Project

The NLP service is running --- but there's nothing to "see" on it yet.
It is a **backend API**, not the website.

You can confirm that the NLP service is alive by opening:

**Health Check:** http://127.0.0.1:8000/health

You should get:

``` json
{"status":"ok"}
```

You can also open:

**FastAPI Swagger UI:** http://127.0.0.1:8000/docs

This provides an interactive interface for testing the NLP API and is
the closest thing to a visual view of this service.

------------------------------------------------------------------------

## To See the Actual Website

To actually use and see the project, you need to run the other
components as well.

You will need **three terminals running simultaneously**:

  Service              Port Purpose
  ---------------- -------- -------------------------
  NLP Service        `8000` NLP/backend processing
  Express Server     `5000` Main backend/API
  React Client       `5173` Actual website/frontend

> **Important:** Do not close the terminal where the NLP service is
> running. Leave `uvicorn` running.

------------------------------------------------------------------------

## 1. MongoDB

MongoDB is required by the server for:

-   Users
-   Documents
-   Chat
-   Other application data

### Option A --- Using Docker Desktop

If you have Docker Desktop installed, run:

``` powershell
docker compose up -d mongo
```

### Option B --- Installing MongoDB Directly

If you don't have Docker, install **MongoDB Community Server** directly
and make sure MongoDB is running on:

``` text
mongodb://localhost:27017
```

------------------------------------------------------------------------

## 2. Express Server

Open a **new terminal**. Keep the NLP service terminal running.

Navigate to the server directory:

``` powershell
cd C:\Users\Millind\Downloads\docqa-final-part4\docqa\server
```

Install the dependencies:

``` powershell
npm install
```

Create the environment file:

``` powershell
copy .env.example .env
```

### Configure `.env`

Open:

``` text
server\.env
```

At minimum, configure the following:

### Gemini or Groq API Key

You need either:

-   `GEMINI_API_KEY`
-   `GROQ_API_KEY`

Without one of these, features such as:

-   Chat
-   Quiz
-   Key Points

will not work.

You can obtain an API key from:

-   [Google AI Studio](https://aistudio.google.com/apikey)
-   [Groq Console](https://console.groq.com/keys)

### JWT Secret

Set:

``` env
JWT_SECRET=your-long-random-secret
```

Use any sufficiently long random string.

Then start the Express server:

``` powershell
npm run dev
```

The server should print something similar to:

``` text
listening on port 5000
```

------------------------------------------------------------------------

## 3. React Client

Open **another new terminal**.

Navigate to the client directory:

``` powershell
cd C:\Users\Millind\Downloads\docqa-final-part4\docqa\client
```

Install the dependencies:

``` powershell
npm install
```

Start the React development server:

``` powershell
npm run dev
```

You should get a local URL similar to:

``` text
http://localhost:5173
```

Open that URL in your browser.

This is the **actual DocQA website**.

------------------------------------------------------------------------

# Final Setup

You should now have **three terminals running simultaneously**:

### Terminal 1 --- NLP Service

``` powershell
cd C:\Users\Millind\Downloads\docqa-final-part4\docqa\nlp-service
uvicorn app.main:app --reload --port 8000
```

**Port:** `8000`

### Terminal 2 --- Express Server

``` powershell
cd C:\Users\Millind\Downloads\docqa-final-part4\docqa\server
npm run dev
```

**Port:** `5000`

### Terminal 3 --- React Client

``` powershell
cd C:\Users\Millind\Downloads\docqa-final-part4\docqa\client
npm run dev
```

**Port:** `5173`

------------------------------------------------------------------------

## Accessing the Project

  URL                              What it shows
  -------------------------------- --------------------------
  `http://127.0.0.1:8000/health`   NLP service health check
  `http://127.0.0.1:8000/docs`     FastAPI Swagger UI
  `http://localhost:5173`          **Actual DocQA website**

Once the React client is running, open:

**http://localhost:5173**

You should be able to go through the application flow:

``` text
Register / Login
       ↓
Upload a document
       ↓
Process the document
       ↓
Chat with the document
       ↓
Quiz / Key Points
```
