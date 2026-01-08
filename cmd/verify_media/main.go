package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	// Tokens
	tokenRx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0"
	tokenTx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA"

	// Simulate a 10KB Image
	dummyImage := make([]byte, 10*1024)
	for i := range dummyImage {
		dummyImage[i] = byte(i % 256)
	}
	encodedImage := base64.StdEncoding.EncodeToString(dummyImage)
	fmt.Printf("Prepared Image Payload: %d bytes\n", len(encodedImage))

	// Connect Receiver
	connRx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}
	defer connRx.Close()

	// Background Listener
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, msg, err := connRx.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) > 100 {
				log.Printf("Rx received LARGE message (%d bytes). Starts with: %s...", len(msg), string(msg[:50]))
				return
			}
		}
	}()

	// Connect Sender
	connTx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenTx}})
	if err != nil {
		log.Fatal("Tx connect error:", err)
	}
	defer connTx.Close()

	// Send Image Message
	// type: "image" is just metadata for the client app to know how to render it
	msg := fmt.Sprintf(`{"receiver_id": 3, "content": "%s", "type": "image"}`, encodedImage)
	connTx.WriteMessage(websocket.TextMessage, []byte(msg))
	log.Println("Sender sent image...")

	// Wait for receipt
	select {
	case <-done:
		log.Println("SUCCESS: Image received via WebSocket!")
	case <-time.After(5 * time.Second):
		log.Fatal("Timeout: Image not received")
	}
}
