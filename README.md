# AwsemChat Backend - Final Walkthrough

## Project Overview
This project is a secure, high-performance Chat Backend built with **Go (Golang)**, designed for low latency and privacy. It supports real-time messaging, E2E encryption compatibility, extensive wallet/fintech features, and social elements like Stories/Promotions.

### Architecture
- **Framework**: Labstack Echo v4 (High performance Web Framework)
- **Database**: PostgreSQL with GORM (Clean Architecture pattern)
- **Real-time**: Gorilla WebSocket (Hub-based concurrency model)
- **Push Handlers**: Firebase Cloud Messaging (FCM) v4

### Key Design Highlights
1.  **Privacy-First Messaging**:
    -   **Online Users**: Messages are ephemeral. They pass through RAM -> WebSocket directly. No DB Persistence.
    -   **Offline Users**: "Store-and-Forward" mechanism. Messages are encrypted, stored temporarily in DB, delivered when user connects, and *immediately auto-deleted*.
2.  **Fintech Integration**: Atomic transactions for Wallet transfers and Marketplace purchases.
3.  **Signal Protocol Ready**: Dedicated APIs for Identity Key & PreKey storage to support client-side E2E encryption libraries (like libsignal).

## Setup & Run

1. **Database**
   Ensure PostgreSQL is running and database `awsemchat` exists.
   ```bash
   psql -h localhost -U postgres -c "CREATE DATABASE awsemchat;"
   ```

2. **Run Server**
   ```bash
   # Set Connection String as Env Var (adjust password/user as needed)
   DATABASE_URL="postgres://postgres:postgres@localhost:5432/awsemchat?sslmode=disable" go run cmd/server/main.go
   ```
   server listens on `:8080`.

3. **Firebase Setup (Optional)**
   To enable Push Notifications, set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON file path.
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="path/to/firebase-service-account.json"
   ```
   If not set, the server will log a warning and skip sending notifications.

## Features Verification

### 1. Authentication (OTP & PIN)
- **Send OTP**: `POST /api/v1/auth/otp/send` (Body: `{ "phone": "..."}`). Mock sends "123456".
- **Verify OTP**: `POST /api/v1/auth/otp/verify` (Body: `{ "phone": "...", "code": "123456" }`). Returns `verification_token`.
- **Register**: `POST /api/v1/auth/register` (Body: `{ "verification_token": "...", "name": "...", "password": "PIN" }`).
- **Login**: `POST /api/v1/auth/login` (Body: `{ "verification_token": "...", "password": "PIN" }`). Returns `token` (Access) and `refresh_token`.
- **Refresh Token**: `POST /api/v1/auth/token/refresh` (Body: `{ "refresh_token": "..." }`). Returns new `token`.
- **Profile**: `GET /api/v1/profile`

### 2. Messaging (E2E & WebSocket)
- **Keys**: Client uploads keys to `POST /api/v1/keys`. Other users fetch via `GET /api/v1/keys/prekey/:id`.
- **WebSocket**: `/api/v1/ws` (Requires `Authorization: Bearer <token>` header).
  - **Send Message**: `{ "receiver_id": 2, "content": "base64...", "type": "text" }`
  - **Context Reply**: `"reply_to_status_id": 1` or `"reply_to_product_id": 1`
  - **Server Ack**: `{ "type": "message_ack", "id": 123, "temp_id": "..." }` (Immediate confirmation)
  - **Delivery Receipt**: `{ "type": "delivery_receipt", "id": 123, "receiver_id": 1 }` (Client sends upon receipt)
  - **Read Receipt**: `{ "type": "read_receipt", "id": 123, "receiver_id": 1 }` (Client sends upon read)
  - **Receive Message**: `{ "sender_id": 1, "content": "...", "type": "text", ... }`

#### Blocks
- **Block User**: `POST /api/v1/users/block` - `{ "user_id": 123 }`. Prevents messaging and status viewing.
- **Unblock User**: `POST /api/v1/users/unblock` - `{ "user_id": 123 }`. Restores access.

### 3. Wallet & Store
- **Send Money**: `POST /api/v1/wallet/send` (Atomic transfer).
- **Request Money**: `POST /api/v1/wallet/request` (Returns ID & Link).
- **Pay Request**: `POST /api/v1/wallet/request/:id/pay`.
- **Create Product**: `POST /api/v1/products`
- **Buy Product**: `POST /api/v1/orders`. Automatically transfers money from Buyer -> Seller.

### 4. Status, Promotions, Profile
- **Edit Profile**: `PUT /api/v1/profile` (Name, Bio, AvatarURL).
- **Update FCM Token**: `PUT /api/v1/profile/fcm` (For Push Notifications).
- **Status**: `POST /api/v1/status` (Expires in 24h).
- **Feed**: `GET /api/v1/status`.
- **Promotions**: `POST /api/v1/promotions` (Expires in 7d).

## Verified Scenarios
- [x] User Registration & PIN Generation
- [x] **Phone Verification (OTP)**
    - [x] Verified Send/Verify OTP flow.
    - [x] Verified Register requires OTP token.
    - [x] Verified Login requires OTP token.
- [x] E2E Key Upload & Fetch
- [x] Real-time Private Messaging (User 1 -> User 3)
- [x] Group Messaging (Fan-out to members)
- [x] Wallet Transfer (Checked DB balances)
- [x] Store Purchase (Insufficient fund rejection & Successful purchase)
- [x] Status Posting & Feed Retrieval
- [x] **Privacy Mode (Auto-Delete)**
    - [x] Verified that messages to online users are NOT stored in DB.
    - [x] Verified that messages to offline users are stored temporarily and deleted immediately after delivery.
- [x] **Message Receipts**
    - [x] Server Ack ("Centang 1") - Immediate `message_ack`.
    - [x] Delivery Receipt ("Centang 2") - End-to-End verified.
    - [x] Read Receipt ("Blue Check") - End-to-End verified.
- [x] **User Blocking**
    - [x] Verified Blocked users cannot send messages (Dropped by Hub).
- [x] **Push Notifications (FCM)**
    - [x] Confirmed `UpdateFCMToken` saves user device tokens.
    - [x] Confirmed Offline logic triggers real Firebase calls.
- [x] **Search**
    - [x] User Search by PIN, Name, Phone (`GET /users/search`).
    - [x] Verified limiting results to public fields.
- [x] **Voice & Video Signaling**
    - [x] WebRTC Signaling Relay (`call_offer`, `call_answer`, `ice_candidate`).
    - [x] Call Logging (Start/End events).
- [x] **Group Enhancements**
    - [x] Invite Codes (Generate/Rotate).
    - [x] Join via Code.
    - [x] Admin Roles (Promote/Kick).
- [x] **Rich Media**
    - [x] Verified Sticker, GIF, and Audio Blob transmission.
    - [x] Verified persistence of binary content.
- [x] **Multi-Device Support**
    - [x] Verified Device ID generation and JWT claims.
    - [x] Verified Message Fan-out to multiple devices.
    - [x] Verified Simultaneous WebSocket connections.
- [x] **Device Linking**
    - [x] Verified QR Code generation (Web Client).
    - [x] Verified QR Scan & Link (Phone Client).
    - [x] Verified Automatic Token Bootstrap (Server -> Web).

---

# Development Task List

- [x] Project Initialization
    - [x] Initialize Go Module
    - [x] Setup Folder Structure (cmd, internal, pkg, configs)
    - [x] Setup Database Connection (Postgres) & Migrations
- [x] Core Architecture & Database Design
    - [x] Design Database Schema (Users, Wallets, Messages, Groups, Keys, Status)
    - [x] Setup WebSocket Hub/Manager
- [x] APIs - Authentication & Identity
    - [x] Review & Finalize Phone Verification
    - [x] Registration with PIN Generation
    - [x] User Profile & Settings
- [x] APIs - E2E Encryption Support (Signal Protocol compatible storage)
    - [x] Store PreKeys & Identity Keys
    - [x] Fetch PreKeys
- [x] APIs - Core Messaging Features
    - [x] Realtime Typing Indicators (WebSocket Ephemeral)
    - [x] User Presence (Online Status & Last Seen)
- [x] APIs - Messaging
    - [x] Private Chat WebSocket Handler
    - [x] Message Persistence (Encrypted blobs)
    - [x] Group Chat Management (Create, Join, Leave)
    - [x] Group Messaging
- [x] APIs - Media & Rich Content
    - [x] Embedded Media (Base64 over WebSocket)
    - [x] Stickers, GIFs, Voice Notes Support
- [x] APIs - Features
    - [x] Wallet System (Balance, Transaction, Send Money)
    - [x] Store/Marketplace
        - [x] Product Management (CRUD: Title, valid Price, Images)
        - [x] Purchasing Flow (Order creation + Wallet deduction)
    - [x] Status/Stories (Create, View, Expire)
    - [x] Promotions (Broadcast/Ads)
    - [x] Group Chat - Leave Group, Roles, Invites
    - [x] Profile - Edit (Name, Bio, Photo)
    - [x] Wallet - Request Money & Payment Links
    - [x] Notifications (Real FCM Implementation)
    - [x] Search Functionality
- [x] Privacy Enhancements
    - [x] Ephemeral Messaging (No persistence for online users)
    - [x] Store-and-Forward (Auto-delete after delivery for offline users)
- [x] Verification
    - [x] Integration Tests for Auth & Messaging
    - [x] Manual Verification with WebSocket Client
- [x] **Multi-Device Support** (Phase 9)
    - [x] Data Modeling & Auth Updates
    - [x] Hub Fan-out & Sync logic
- [x] **Device Linking (QR)** (Phase 10)
    - [x] Implementation of `/auth/ws` and `/devices/link`.
    - [x] LinkManager for session handling.

# Roadmap / Future Features
- [ ] History Sync (Restore messages on new device).


