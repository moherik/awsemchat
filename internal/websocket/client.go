package websocket

import (
	"encoding/json"
	"log"
	"time"

	"awsemchat/internal/repository"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024 // 512KB
)

type Client struct {
	Hub *Hub
	// The websocket connection.
	Conn *websocket.Conn
	// Buffered channel of outbound messages.
	Send chan *MessagePayload
	// Identity
	// Identity
	UserID   uint
	DeviceID uint
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()
	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error { c.Conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		// Parse message
		var payload MessagePayload
		if err := json.Unmarshal(message, &payload); err != nil {
			log.Println("Invalid message format:", err)
			continue
		}

		log.Printf("DEBUG READ Payload: %+v", payload) // Debug Print

		// Enforce SenderID based on auth
		payload.SenderID = c.UserID

		// Send to Hub directly. Hub decides (Send or Store).
		// We DO NOT persist here anymore to respect privacy request.
		if payload.GroupID != nil {
			// Group Chat
			groupRep := repository.NewGroupRepository()
			members, err := groupRep.GetGroupMembers(*payload.GroupID)
			if err != nil {
				log.Println("Failed to fetch group members:", err)
				continue
			}

			for _, memberID := range members {
				if memberID == c.UserID {
					continue // Don't echo back
				}

				msgToSend := payload
				msgToSend.ReceiverID = memberID
				c.Hub.Unicast <- &msgToSend
			}

		} else {
			// Private Chat
			c.Hub.Unicast <- &payload
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}

			// JSON Encode the payload to send to client
			json.NewEncoder(w).Encode(message)

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
