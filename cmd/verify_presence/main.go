package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
)

func main() {
	// DB Connection
	db, err := sql.Open("postgres", "postgres://postgres:postgres@localhost:5432/awsemchat?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Fetch User 3 PIN
	var pin string
	err = db.QueryRow("SELECT pin FROM users WHERE id = 3").Scan(&pin)
	if err != nil {
		log.Fatal("Failed to fetch User 3 PIN:", err)
	}
	log.Printf("User 3 PIN: %s", pin)

	// Tokens
	tokenRx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0"
	tokenTx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA"

	// --- TEST 1: ONLINE STATUS ---
	log.Println("--- TEST 1: ONLINE STATUS ---")

	// Check Status BEFORE connecting (Expect is_online=false)
	checkOnlineStatus("Initial (Offline)", pin, false, tokenTx)

	// Connect User 3 (Receiver)
	connRx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}
	// Defer close is tricky here because we want to test offline status after close too.

	// Wait for registration
	time.Sleep(500 * time.Millisecond)

	// Check Status AFTER connecting (Expect is_online=true)
	checkOnlineStatus("Connected (Online)", pin, true, tokenTx)

	// Close connection to test disconnect update
	connRx.Close()
	time.Sleep(500 * time.Millisecond)

	// Check Status AFTER disconnect (Expect is_online=false)
	checkOnlineStatus("Disconnected (Offline)", pin, false, tokenTx)

	// Reconnect for typing test
	connRx, _, err = websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}
	defer connRx.Close()

	// --- TEST 2: TYPING INDICATOR ---
	log.Println("--- TEST 2: TYPING INDICATOR ---")

	// Background Reader for Receiver
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, msg, err := connRx.ReadMessage()
			if err != nil {
				return
			}
			log.Printf("Rx Received: %s", msg)

			var payload map[string]interface{}
			if err := json.Unmarshal(msg, &payload); err == nil {
				if payload["type"] == "typing" {
					log.Println("SUCCESS: Received Typing Indicator!")
					return
				}
			}
		}
	}()

	// Connect Sender
	connTx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenTx}})
	if err != nil {
		log.Fatal("Tx connect error:", err)
	}
	defer connTx.Close()

	// Send TYPING
	msg := `{"receiver_id": 3, "content": "", "type": "typing"}`
	connTx.WriteMessage(websocket.TextMessage, []byte(msg))
	log.Println("Sender sent 'typing'...")

	// Wait
	select {
	case <-done:
		log.Println("Test 2 PASSED")
	case <-time.After(3 * time.Second):
		log.Fatal("Test 2 FAILED: Timeout waiting for typing")
	}
}

func checkOnlineStatus(stage, pin string, expected bool, token string) {
	url := fmt.Sprintf("http://localhost:8080/api/v1/users/%s", pin)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("[%s] Failed to fetch profile: %v", stage, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var profile map[string]interface{}
	if err := json.Unmarshal(body, &profile); err != nil {
		log.Fatalf("[%s] Failed to parse JSON: %v", stage, err)
	}

	isOnline, ok := profile["is_online"].(bool)
	if !ok {
		log.Fatalf("[%s] is_online field missing", stage)
	}

	log.Printf("[%s] User %s is_online=%v (Expected=%v)", stage, pin, isOnline, expected)

	if isOnline != expected {
		log.Fatalf("TEST FAILED: [%s] Expected is_online=%v, got %v", stage, expected, isOnline)
	}
}
