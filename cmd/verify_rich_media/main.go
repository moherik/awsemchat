package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	baseURL = "http://localhost:8080/api/v1"
	wsURL   = "ws://localhost:8080/api/v1/ws"
)

type MessagePayload struct {
	ID         uint   `json:"id,omitempty"`
	TempID     string `json:"temp_id,omitempty"`
	SenderID   uint   `json:"sender_id"`
	ReceiverID uint   `json:"receiver_id"`
	Content    []byte `json:"content,omitempty"`
	Type       string `json:"type"`
}

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup User A and User B
	tokenA, _ := setupUser("UserA")
	tokenB, idB := setupUser("UserB")
	log.Printf("User A ready. User B ID: %.0f", idB)

	// 2. Connect WS
	connA := connectWS(tokenA)
	defer connA.Close()
	connB := connectWS(tokenB)
	defer connB.Close()

	// 3. Send STICKER
	log.Println("--- Sending STICKER ---")
	sendAndVerify(connA, connB, uint(idB), "sticker", "sticker:cat_laughing_123")

	// 4. Send GIF
	log.Println("--- Sending GIF ---")
	sendAndVerify(connA, connB, uint(idB), "gif", "https://media.giphy.com/media/test/giphy.gif")

	// 5. Send AUDIO (Voice Note)
	// Create a 5KB dummy blob
	dummyAudio := strings.Repeat("A", 5000)
	log.Println("--- Sending AUDIO (5KB Blob) ---")
	sendAndVerify(connA, connB, uint(idB), "audio", dummyAudio)

	log.Println("ALL TESTS PASSED")
}

func sendAndVerify(sender *websocket.Conn, receiver *websocket.Conn, receiverID uint, msgType string, content string) {
	tempID := fmt.Sprintf("msg-%d", time.Now().UnixNano())

	// Send
	msg := MessagePayload{
		ReceiverID: receiverID,
		Type:       msgType,
		Content:    []byte(content),
		TempID:     tempID,
	}
	sender.WriteJSON(msg)

	// Verify ACK (Sender)
	// Read loop with timeout
	sender.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var ack MessagePayload
		if err := sender.ReadJSON(&ack); err != nil {
			log.Fatalf("Sender failed to receive ACK for %s: %v", msgType, err)
		}
		if ack.Type == "message_ack" && ack.TempID == tempID {
			log.Printf("Sender got ACK for %s", msgType)
			break
		}
	}

	// Verify Delivery (Receiver)
	receiver.SetReadDeadline(time.Now().Add(2 * time.Second))
	var received MessagePayload
	if err := receiver.ReadJSON(&received); err != nil {
		log.Fatalf("Receiver failed to get %s: %v", msgType, err)
	}

	if received.Type != msgType {
		log.Fatalf("Expected type %s, got %s", msgType, received.Type)
	}
	if string(received.Content) != content {
		log.Fatalf("Content mismatch for %s. Length: %d vs %d", msgType, len(received.Content), len(content))
	}

	log.Printf("Receiver got %s correctly", msgType)
}

// Helpers
func setupUser(name string) (string, float64) {
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"
	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, name, pin)
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
