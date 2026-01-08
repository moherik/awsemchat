package main

import (
	"bytes"
	"database/sql"
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

	// Tokens
	tokenRx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjozLCJleHAiOjE3NjgxMTkyNTR9.u2JrqU08UcrVlLKkVQ_g3gT1JEXkDM_u_LOzfIS16c0"
	tokenTx := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJleHAiOjE3NjgxMTkyNDl9.Jm9bN6ZguyzLygErN9iv4NqjqsdJj6J0e-UaqshcBUA"

	// --- TEST 1: ONLINE EPHEMERAL ---
	log.Println("--- TEST 1: ONLINE EPHEMERAL ---")

	// Ensure DB is clean of messages for receiver 3
	db.Exec("DELETE FROM messages WHERE recipient_id = 3")

	// Set FCM Token for User 3 (Receiver)
	log.Println("Setting FCM Token for User 3...")
	client := &http.Client{}
	req, _ := http.NewRequest("PUT", "http://localhost:8080/api/v1/profile/fcm", bytes.NewBuffer([]byte(`{"token": "dummy_fcm_token_123"}`)))
	req.Header.Set("Authorization", "Bearer "+tokenRx)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("Failed to set FCM Token: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Fatalf("Failed to set FCM Token: Status %d", resp.StatusCode)
	}
	log.Println("FCM Token Set Successfully.")

	connRx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}

	// background reader
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, _, err := connRx.ReadMessage()
			if err != nil {
				return
			}
			log.Println("Rx received message (Test 1)")
			return
		}
	}()

	// Wait for registration to propagate
	time.Sleep(500 * time.Millisecond)

	connTx, _, err := websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenTx}})
	if err != nil {
		log.Fatal("Tx connect error:", err)
	}

	// Send message
	msg := `{"receiver_id": 3, "content": "T25saW5lIE1zZw==", "type": "text"}` // "Online Msg"
	connTx.WriteMessage(websocket.TextMessage, []byte(msg))

	// Wait for receipt
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Fatal("Test 1 Timeout")
	}

	connTx.Close()
	connRx.Close()
	time.Sleep(1 * time.Second) // Let server process closing

	// CHECK DB: Should be EMPTY
	var count int
	db.QueryRow("SELECT COUNT(*) FROM messages WHERE recipient_id = 3").Scan(&count)
	if count != 0 {
		log.Fatalf("Test 1 FAILED: Expected 0 messages in DB, found %d", count)
	} else {
		log.Println("Test 1 PASSED: Message not in DB (Ephemeral)")
	}

	// --- TEST 2: OFFLINE STORE & FORWARD ---
	log.Println("--- TEST 2: OFFLINE STORE & FORWARD ---")

	// Ensure User 3 is offline (connections closed above)

	// Reconnect User 1 (Sender)
	connTx, _, err = websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenTx}})
	if err != nil {
		log.Fatal("Tx connect error:", err)
	}

	// Send message
	msg = `{"receiver_id": 3, "content": "T2ZmbGluZSBNc2c=", "type": "text"}` // "Offline Msg"
	connTx.WriteMessage(websocket.TextMessage, []byte(msg))
	time.Sleep(1 * time.Second) // Wait for server to store
	connTx.Close()

	// CHECK DB: Should have 1 record
	db.QueryRow("SELECT COUNT(*) FROM messages WHERE recipient_id = 3").Scan(&count)
	if count == 0 {
		log.Fatal("Test 2 FAILED (Part A): Message not stored in DB when offline")
	} else {
		log.Printf("Test 2 (Part A) PASSED: Message stored in DB (Count: %d). Now connecting receiver...", count)
	}

	// Connect User 3 (Receiver)
	connRx, _, err = websocket.DefaultDialer.Dial("ws://localhost:8080/api/v1/ws", http.Header{"Authorization": []string{"Bearer " + tokenRx}})
	if err != nil {
		log.Fatal("Rx connect error:", err)
	}

	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		for {
			_, msg, err := connRx.ReadMessage()
			if err != nil {
				return
			}
			log.Printf("Rx received message (Test 2): %s", msg)
			return
		}
	}()

	// Wait for delivery of stored message
	select {
	case <-done2:
	case <-time.After(5 * time.Second):
		log.Fatal("Test 2 Timeout (Part B): Did not receive stored message")
	}
	connRx.Close()

	// CHECK DB: Should be EMPTY again
	time.Sleep(1 * time.Second)
	db.QueryRow("SELECT COUNT(*) FROM messages WHERE recipient_id = 3").Scan(&count)
	if count != 0 {
		log.Fatalf("Test 2 FAILED (Part C): Message not deleted from DB after delivery. Found: %d", count)
	} else {
		log.Println("Test 2 PASSED ALL: Online=Ephemeral, Offline=Store-Forward-Delete.")
	}
}
