package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
	SenderID         uint   `json:"sender_id"`
	ReceiverID       uint   `json:"receiver_id"`
	Content          []byte `json:"content"`
	Type             string `json:"type"`
	ReplyToStatusID  *uint  `json:"reply_to_status_id,omitempty"`
	ReplyToProductID *uint  `json:"reply_to_product_id,omitempty"`
}

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup User A & B
	tokenA, idA := setupUser()
	tokenB, idB := setupUser()
	log.Printf("User A: %.0f, User B: %.0f", idA, idB)

	// 2. Connect WS for User B (Receiver)
	connB := connectWS(tokenB)
	defer connB.Close()
	log.Println("User B connected to WS")

	// 3. Connect WS for User A (Sender)
	connA := connectWS(tokenA)
	defer connA.Close()
	log.Println("User A connected to WS")

	// 4. Send Contextual Message (Reply to Status)
	statusID := uint(123)
	msg := MessagePayload{
		ReceiverID:      uint(idB),
		Content:         []byte("Cool status!"),
		Type:            "text",
		ReplyToStatusID: &statusID,
	}
	if err := connA.WriteJSON(msg); err != nil {
		log.Fatal("Failed to send message:", err)
	}
	log.Println("User A sent message replying to Status 123")

	// 5. User B receives
	var received MessagePayload
	if err := connB.ReadJSON(&received); err != nil {
		log.Fatal("User B failed to read:", err)
	}

	if received.ReplyToStatusID == nil {
		log.Fatal("Received message missing ReplyToStatusID")
	}
	if *received.ReplyToStatusID != 123 {
		log.Fatalf("Expected StatusID 123, got %d", *received.ReplyToStatusID)
	}
	log.Println("User B received context correctly (Status Reply).")

	// 6. Send Contextual Message (Ask Product)
	productID := uint(999)
	msg2 := MessagePayload{
		ReceiverID:       uint(idB),
		Content:          []byte("Is this available?"),
		Type:             "text",
		ReplyToProductID: &productID,
	}
	if err := connA.WriteJSON(msg2); err != nil {
		log.Fatal("Failed to send message 2:", err)
	}
	log.Println("User A sent message asking about Product 999")

	// 7. User B receives
	if err := connB.ReadJSON(&received); err != nil {
		log.Fatal("User B failed to read 2:", err)
	}
	if received.ReplyToProductID == nil {
		log.Fatal("Received message missing ReplyToProductID")
	}
	if *received.ReplyToProductID != 999 {
		log.Fatalf("Expected ProductID 999, got %d", *received.ReplyToProductID)
	}
	log.Println("User B received context correctly (Product Inquiry).")

	log.Println("ALL TESTS PASSED")
}

// Helpers

func setupUser() (string, float64) {
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"

	// Register user
	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, "User "+phone, pin)

	// Login user
	code2 := sendOTP(phone)
	token2 := verifyOTP(phone, code2) // Use new code

	return login(token2, pin)
}

func sendOTP(phone string) string {
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res["debug_code"].(string)
}

func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/verify", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)

	if res["error"] != "" {
		log.Fatalf("Verify OTP Failed for %s/%s: %s", phone, code, res["error"])
	}

	return res["verification_token"]
}

func register(token, name, pin string) {
	payload := map[string]string{"verification_token": token, "name": name, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal("Register Req Failed:", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Register Failed: %s", body)
	}
}

func login(token, pin string) (string, float64) {
	payload := map[string]string{"verification_token": token, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	if res["user"] == nil {
		log.Fatalf("Login failed: %+v", res)
	}
	user := res["user"].(map[string]interface{})
	return res["token"].(string), user["id"].(float64)
}

func connectWS(token string) *websocket.Conn {
	u, _ := url.Parse(wsURL)
	header := http.Header{}
	header.Add("Authorization", "Bearer "+token)

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		log.Printf("WS Dial Error Payload: Token=%s...", token[:10])
		log.Fatal("WS Dial:", err)
	}
	return conn
}
