package websocket

import (
	"context"
	"log"
	"sync"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
)

type Hub struct {
	// Registered clients map: UserID -> Client
	clients map[uint]*Client

	// Locks for the clients map
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
}

type MessagePayload struct {
	SenderID   uint   `json:"sender_id"`
	ReceiverID uint   `json:"receiver_id"`
	Content    []byte `json:"content"` // Encrypted blob
	Type       string `json:"type"`    // text, image, etc
	GroupID    *uint  `json:"group_id,omitempty"`
}

func NewHub() *Hub {
	h := &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		clients:    make(map[uint]*Client),
		Unicast:    make(chan *MessagePayload),
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
			// If already connected, close old connection? Or allow multiple?
			// For simplicity: Overwrite (kick old)
			if old, ok := h.clients[client.UserID]; ok {
				close(old.Send)
				delete(h.clients, client.UserID)
			}
			h.clients[client.UserID] = client
			h.mu.Unlock()
			log.Printf("User %d registered to Hub", client.UserID)

			// Flush pending messages asynchronously
			go h.FlushPendingMessages(client.UserID)

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.UserID]; ok {
				delete(h.clients, client.UserID)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("User %d unregistered from Hub", client.UserID)

		case message := <-h.Unicast:
			h.mu.RLock()
			recipient, ok := h.clients[message.ReceiverID]
			h.mu.RUnlock()

			if ok {
				// Send to recipient
				select {
				case recipient.Send <- message:
					// Delivered successfully implies we DON'T store it.
					// Privacy Mode Active.
				default:
					// Buffer full or disconnected
					close(recipient.Send)
					h.mu.Lock()
					delete(h.clients, message.ReceiverID)
					h.mu.Unlock()

					// Store as pending since delivery failed (buffer full)
					h.storePendingMessage(message)
				}
			} else {
				// Recipient is offline. Persist for later delivery.
				log.Printf("User %d is offline. Storing message.", message.ReceiverID)
				h.storePendingMessage(message)

				// TRIGGER PUSH NOTIFICATION
				// In production: Fire and forget to FCM Worker
				go h.SendPushNotification(message.ReceiverID)
			}
		}
	}
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

func (h *Hub) storePendingMessage(payload *MessagePayload) {
	dbMsg := models.Message{
		SenderID:    payload.SenderID,
		RecipientID: &payload.ReceiverID,
		Content:     payload.Content,
		Type:        payload.Type,
		GroupID:     payload.GroupID,
		CreatedAt:   time.Now(),
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
			SenderID:   msg.SenderID,
			ReceiverID: userID, // Known
			Content:    msg.Content,
			Type:       msg.Type,
			GroupID:    msg.GroupID,
		}

		// Delete from DB first to avoid duplicates if Unicast re-stores it
		// Transaction would be better but keeping it simple for now
		database.DB.Delete(&msg)

		// Send to Unicast for delivery
		h.Unicast <- payload
	}
}
