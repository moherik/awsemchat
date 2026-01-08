package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	// Token for User 3 (Receiver, Member of Group 1)
	tokenRx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0"
	// Token for User 1 (Sender, Admin of Group 1)
	tokenTx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA"

	// Connect Receiver
	connRx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}
	defer connRx.Close()
	log.Println("Receiver connected")

	// Start reading in background
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, message, err := connRx.ReadMessage()
			if err != nil {
				log.Println("Rx read error:", err)
				return
			}
			log.Printf("Receiver got message: %s", message)
			// Check if it looks like group message?
			// {"sender_id":1,"receiver_id":3,"content":"R3JvdXAgTXNn","type":"text","group_id":1}
			return
		}
	}()

	// Connect Sender
	connTx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenTx}})
	if err != nil {
		log.Fatal("Tx connect error:", err)
	}
	defer connTx.Close()
	log.Println("Sender connected")

	// Send GROUP message
	// "Group Msg" in base64 = "R3JvdXAgTXNn"
	msg := `{"group_id": 1, "content": "R3JvdXAgTXNn", "type": "text"}`
	if err := connTx.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		log.Fatal("Tx write error:", err)
	}
	log.Println("Sender sent GROUP message")

	// Wait for receipt
	select {
	case <-done:
		log.Println("Test Passed!")
	case <-time.After(5 * time.Second):
		log.Fatal("Test timed out")
	}
}
