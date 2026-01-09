package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

const (
	baseURL = "http://localhost:8080/api/v1"
	wsURL   = "ws://localhost:8080/api/v1/ws"
)

type MessagePayload struct {
	ID         uint   `json:"id,omitempty"`
	SenderID   uint   `json:"sender_id"`
	ReceiverID uint   `json:"receiver_id"`
	Content    []byte `json:"content,omitempty"`
	Type       string `json:"type"`
	// Status removed
}

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup User A & B
	tokenA, idA := setupUser()
	tokenB, idB := setupUser()
	log.Printf("User A: %.0f, User B: %.0f", idA, idB)

	// 2. Connect WS
	connA := connectWS(tokenA)
	defer connA.Close()
	connB := connectWS(tokenB)
	defer connB.Close()

	// 3. User A sends message to B
	log.Println("--- MSG SENT ---")
	msg := MessagePayload{ReceiverID: uint(idB), Content: []byte("Hello"), Type: "text"}
	connA.WriteJSON(msg)

	// 4. User B receives message and sends Delivery Receipt (Client Logic now)
	// We need to simulate B reading the message first from the socket?
	// In this script setup, A waits for delivery. B is just connected.
	// We need B to read the message, then send delivery receipt.

	// Start B reading in background
	go func() {
		for {
			var msg MessagePayload
			if err := connB.ReadJSON(&msg); err != nil {
				log.Println("B Read Error:", err)
				return
			}
			log.Printf("B Received: %+v", msg)
			if msg.Type == "text" {
				// Send Delivery Receipt
				delReceipt := MessagePayload{
					Type:       "delivery_receipt",
					ID:         msg.ID,
					ReceiverID: uint(idA),
				}
				connB.WriteJSON(delReceipt)

				// Then later send Read Receipt
				time.Sleep(100 * time.Millisecond)
				readReceipt := MessagePayload{
					Type:       "read_receipt",
					ID:         msg.ID,
					ReceiverID: uint(idA),
				}
				connB.WriteJSON(readReceipt)
			}
		}
	}()

	// 5. User A waits for "delivered" status update (now from B)
	var deliveredMsgID uint

	// Read Loop for A
	gotDelivered := false
	for i := 0; i < 5; i++ {
		connA.SetReadDeadline(time.Now().Add(2 * time.Second))
		var received MessagePayload
		if err := connA.ReadJSON(&received); err != nil {
			log.Println("A read error:", err)
			continue
		}

		if received.Type == "delivery_receipt" {
			log.Printf("User A received DELIVERED receipt for Msg ID: %d", received.ID)
			deliveredMsgID = received.ID
			gotDelivered = true
			break
		}
	}

	if !gotDelivered {
		log.Fatal("User A did not receive delivered receipt (Timed out)")
	}

	// 6. User A should receive "read_receipt"
	gotRead := false
	for i := 0; i < 5; i++ {
		connA.SetReadDeadline(time.Now().Add(2 * time.Second))
		var received MessagePayload
		if err := connA.ReadJSON(&received); err != nil {
			log.Println("A read error (expected if timeout):", err)
			break
		}
		if received.Type == "read_receipt" && received.ID == deliveredMsgID {
			log.Printf("User A received READ receipt for Msg ID: %d", received.ID)
			gotRead = true
			break
		}
	}
	if !gotRead {
		log.Fatal("User A did not receive read receipt")
	}

	log.Println("ALL TESTS PASSED")
}

// Helpers... (Copy from verify_block but stripped)
func setupUser() (string, float64) {
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"
	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, "User "+phone, pin)
	code2 := sendOTP(phone)
	token2 := verifyOTP(phone, code2)
	return login(token2, pin)
}
func sendOTP(phone string) string {
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, _ := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res["debug_code"].(string)
}
func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	jsonPayload, _ := json.Marshal(payload)
	resp, _ := http.Post(baseURL+"/auth/otp/verify", "application/json", bytes.NewBuffer(jsonPayload))
	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)
	return res["verification_token"]
}
func register(token, name, pin string) {
	payload := map[string]string{"verification_token": token, "name": name, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
}
func login(token, pin string) (string, float64) {
	payload := map[string]string{"verification_token": token, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	resp, _ := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	user := res["user"].(map[string]interface{})
	return res["token"].(string), user["id"].(float64)
}
func connectWS(token string) *websocket.Conn {
	u, _ := url.Parse(wsURL)
	header := http.Header{}
	header.Add("Authorization", "Bearer "+token)
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		log.Fatal(err)
	}
	return conn
}
