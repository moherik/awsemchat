package websocket

import (
	"context"
	"log"
	"sync"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
)

type Hub struct {
	// Registered clients map: UserID -> DeviceID -> Client
	clients map[uint]map[uint]*Client

	// Locks for the clients map (and presence)
	mu sync.RWMutex

	// Inbound messages from the clients.
	// We might not use this global broadcast for private chat, but good to have.
	Broadcast chan []byte

	// Register requests from the clients.
	Register chan *Client

	// Unregister requests from clients.
	Unregister chan *Client

	// Direct message channel
	Unicast chan *MessagePayload

	// Firebase Client
	FCMClient *messaging.Client

	UserRepo *repository.UserRepository
}

type MessagePayload struct {
	ID               uint   `json:"id,omitempty"`
	TempID           string `json:"temp_id,omitempty"` // Client-side ID for Ack matching
	SenderID         uint   `json:"sender_id"`
	ReceiverID       uint   `json:"receiver_id"`
	Content          []byte `json:"content,omitempty"` // Encrypted blob
	Type             string `json:"type"`              // text, image, etc, read_receipt, message_status
	GroupID          *uint  `json:"group_id,omitempty"`
	ReplyToStatusID  *uint  `json:"reply_to_status_id,omitempty"`
	ReplyToProductID *uint  `json:"reply_to_product_id,omitempty"`
}

func NewHub() *Hub {
	h := &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		clients:    make(map[uint]map[uint]*Client),
		Unicast:    make(chan *MessagePayload),
		UserRepo:   repository.NewUserRepository(),
	}

	// Initialize Firebase
	ctx := context.Background()
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		log.Printf("Warning: Failed to init Firebase App: %v", err)
	} else {
		client, err := app.Messaging(ctx)
		if err != nil {
			log.Printf("Warning: Failed to init FCM Client: %v", err)
		} else {
			h.FCMClient = client
			log.Println("Firebase FCM Client Initialized")
		}
	}

	return h
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			// Initialize inner map if nil
			if h.clients[client.UserID] == nil {
				h.clients[client.UserID] = make(map[uint]*Client)
			}

			// Register or Overwrite Connection for this DeviceID
			if old, ok := h.clients[client.UserID][client.DeviceID]; ok {
				close(old.Send) // Close old connection on same device
			}
			h.clients[client.UserID][client.DeviceID] = client

			h.mu.Unlock()
			log.Printf("User %d (Device %d) registered", client.UserID, client.DeviceID)

			// Flush messages (One-time, assuming shared queue. If queue is per-user, this is fine)
			go h.FlushPendingMessages(client.UserID)

		case client := <-h.Unregister:
			h.mu.Lock()
			if userDevices, ok := h.clients[client.UserID]; ok {
				if _, ok := userDevices[client.DeviceID]; ok {
					delete(userDevices, client.DeviceID)
					close(client.Send)

					// If no more devices, remove user entry
					if len(userDevices) == 0 {
						delete(h.clients, client.UserID)
					}
				}
			}

			h.mu.Unlock()
			log.Printf("User %d (Device %d) unregistered", client.UserID, client.DeviceID)

			// Update LastSeen (Only if last device?) - Keeping simple for now
			go func(uid uint) {
				if err := database.DB.Model(&models.User{}).Where("id = ?", uid).Update("last_seen", time.Now()).Error; err != nil {
					log.Printf("Failed to update LastSeen for user %d: %v", uid, err)
				}
			}(client.UserID)

		case message := <-h.Unicast:

			h.mu.RLock()
			userDevices, ok := h.clients[message.ReceiverID]
			// Copy devices list to avoid locking during send loop
			var connectedClients []*Client
			if ok {
				for _, c := range userDevices {
					connectedClients = append(connectedClients, c)
				}
			}
			h.mu.RUnlock()

			// Check Blocking
			if h.UserRepo.IsBlocked(message.ReceiverID, message.SenderID) {
				log.Printf("Message dropped: User %d blocked User %d", message.ReceiverID, message.SenderID)
				continue
			}

			h.SendAck(message)

			// WebRTC Signaling Logic (Relay to all devices?)
			// Yes, usually ring all.
			if message.Type == "call_offer" || message.Type == "call_answer" || message.Type == "ice_candidate" || message.Type == "call_end" {
				if len(connectedClients) > 0 {
					for _, recipient := range connectedClients {
						select {
						case recipient.Send <- message:
						default:
						}
					}
				} else {
					// Offline logic for Calls (Same as before)
					if message.Type == "call_offer" {
						log.Printf("User %d is offline. Storing signaling message.", message.ReceiverID)
						h.StorePendingMessage(message)
						go h.SendPushNotification(message.ReceiverID)
					}
				}
				if message.Type == "call_end" {
					go h.LogCall(message)
				}
				continue
			}

			if len(connectedClients) > 0 {
				// Fan-out to all devices
				delivered := false
				for _, recipient := range connectedClients {
					select {
					case recipient.Send <- message:
						delivered = true
					default:
						// Buffer full, close this specific device connection
						close(recipient.Send)
						h.mu.Lock()
						if devices, ok := h.clients[message.ReceiverID]; ok {
							delete(devices, recipient.DeviceID)
						}
						h.mu.Unlock()
					}
				}

				if !delivered {
					// If ALL failed?
					h.StorePendingMessage(message)
				}
			} else {
				// Offline
				log.Printf("User %d is offline. Storing message.", message.ReceiverID)
				h.StorePendingMessage(message)
				go h.SendPushNotification(message.ReceiverID)
			}
		}
	}
}

func (h *Hub) SendAck(message *MessagePayload) {
	if message.Type == "message_ack" {
		return
	}

	h.mu.RLock()
	userDevices, ok := h.clients[message.SenderID]
	// Send Ack to ALL sender's devices?
	// Usually only the sending device cares, but we don't know WHICH device sent it easily here
	// unless we pass SenderDeviceID in payload.
	// For now, fan-out Ack to all sender devices so they all know it was received server-side.
	var connectedClients []*Client
	if ok {
		for _, c := range userDevices {
			connectedClients = append(connectedClients, c)
		}
	}
	h.mu.RUnlock()

	ack := MessagePayload{
		TempID:          message.TempID,
		ReceiverID:      message.SenderID,
		Type:            "message_ack",
		GroupID:         message.GroupID,
		ReplyToStatusID: message.ReplyToStatusID,
	}

	for _, sender := range connectedClients {
		select {
		case sender.Send <- &ack:
		default:
		}
	}
}

func (h *Hub) IsUserOnline(userID uint) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	devices, ok := h.clients[userID]
	return ok && len(devices) > 0
}

func (h *Hub) SendPushNotification(userID uint) {
	if h.FCMClient == nil {
		log.Println("FCM Client not initialized. Skipping push.")
		return
	}

	var user models.User
	if err := database.DB.Select("fcm_token").First(&user, userID).Error; err != nil {
		log.Printf("Failed to fetch user %d for push: %v", userID, err)
		return
	}

	if user.FCMToken == "" {
		log.Printf("User %d has no FCM Token.", userID)
		return
	}

	// Create Message
	message := &messaging.Message{
		Token: user.FCMToken,
		Notification: &messaging.Notification{
			Title: "New Message",
			Body:  "You have received a new encrypted message.",
		},
		Data: map[string]string{
			"type": "chat_message",
		},
	}

	// Send
	response, err := h.FCMClient.Send(context.Background(), message)
	if err != nil {
		log.Printf("Failed to send push to User %d: %v", userID, err)
	} else {
		log.Printf("Push sent to User %d: %s", userID, response)
	}
}

func (h *Hub) StorePendingMessage(payload *MessagePayload) {
	dbMsg := models.Message{
		SenderID:         payload.SenderID,
		RecipientID:      &payload.ReceiverID,
		Content:          payload.Content,
		Type:             payload.Type,
		GroupID:          payload.GroupID,
		ReplyToStatusID:  payload.ReplyToStatusID,
		ReplyToProductID: payload.ReplyToProductID,
		CreatedAt:        time.Now(),
	}
	if err := database.DB.Create(&dbMsg).Error; err != nil {
		log.Printf("Failed to store pending message for user %d: %v", payload.ReceiverID, err)
	}
}

func (h *Hub) FlushPendingMessages(userID uint) {
	var messages []models.Message
	// Get messages where this user is the recipient
	if err := database.DB.Where("recipient_id = ?", userID).Find(&messages).Error; err != nil {
		log.Printf("Failed to fetch pending messages for user %d: %v", userID, err)
		return
	}

	for _, msg := range messages {
		// Convert to payload
		payload := &MessagePayload{
			SenderID:         msg.SenderID,
			ReceiverID:       userID, // Known
			Content:          msg.Content,
			Type:             msg.Type,
			GroupID:          msg.GroupID,
			ReplyToStatusID:  msg.ReplyToStatusID,
			ReplyToProductID: msg.ReplyToProductID,
		}

		// Delete from DB first to avoid duplicates if Unicast re-stores it
		// Transaction would be better but keeping it simple for now
		database.DB.Delete(&msg)

		// Send to Unicast for delivery
		h.Unicast <- payload
	}
}

func (h *Hub) LogCall(message *MessagePayload) {
	status := "completed"
	// minimal parsing
	if string(message.Content) == "reason:busy" {
		status = "busy"
	} else if string(message.Content) == "reason:rejected" {
		status = "rejected"
	}

	callLog := models.CallLog{
		SenderID:   message.SenderID,
		ReceiverID: message.ReceiverID,
		Type:       "audio", // Default, or add to payload? Protocol says opaque.
		Status:     status,
		CreatedAt:  time.Now(),
		StartedAt:  time.Now(), // Placeholder
	}

	if err := database.DB.Create(&callLog).Error; err != nil {
		log.Printf("Failed to log call: %v", err)
	}
}
