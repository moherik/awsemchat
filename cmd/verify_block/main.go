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
	SenderID   uint   `json:"sender_id"`
	ReceiverID uint   `json:"receiver_id"`
	Content    []byte `json:"content"`
	Type       string `json:"type"`
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

	// 3. User B Blocks User A
	log.Println("--- TEST 1: BLOCKING ---")
	blockUser(tokenB, uint(idA))

	// 4. User A sends message to B (Should be dropped)
	msg := MessagePayload{SenderID: uint(idA), ReceiverID: uint(idB), Content: []byte("Blocked Msg"), Type: "text"}
	connA.WriteJSON(msg)

	// Wait a bit to ensure it doesn't arrive
	connB.SetReadDeadline(time.Now().Add(2 * time.Second))
	var received MessagePayload
	err := connB.ReadJSON(&received)
	if err == nil {
		log.Fatal("User B received message despite blocking User A!")
	} else {
		log.Println("User B did not receive message (Expected timeout/block).")
	}

	// 5. User B Unblocks User A
	log.Println("--- TEST 2: UNBLOCKING ---")
	unblockUser(tokenB, uint(idA))

	// Reconnect User B to ensure clean state
	connB.Close()
	connB = connectWS(tokenB)
	defer connB.Close()

	// 6. User A sends message (Should arrive)
	msg2 := MessagePayload{SenderID: uint(idA), ReceiverID: uint(idB), Content: []byte("Allowed Msg"), Type: "text"}
	connA.WriteJSON(msg2)

	// Read Loop for B
	gotAllowed := false
	for i := 0; i < 5; i++ {
		connB.SetReadDeadline(time.Now().Add(2 * time.Second))
		var received MessagePayload
		if err := connB.ReadJSON(&received); err != nil {
			log.Println("Read error:", err)
			continue
		}

		log.Printf("User B received: %+v, Content: %s", received, string(received.Content))

		if received.Type == "text" && string(received.Content) == "Allowed Msg" {
			log.Println("User B received message after unblock.")
			gotAllowed = true
			break
		}
	}

	if !gotAllowed {
		log.Fatal("User B failed to receive allowed message")
	}

	log.Println("ALL TESTS PASSED")
}

// Helpers
func blockUser(token string, targetID uint) {
	payload := map[string]uint{"user_id": targetID}
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+"/users/block", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		log.Fatal("Block failed")
	}
	log.Println("User B blocked User A")
}

func unblockUser(token string, targetID uint) {
	payload := map[string]uint{"user_id": targetID}
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+"/users/unblock", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		log.Fatal("Unblock failed")
	}
	log.Println("User B unblocked User A")
}

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
	resp, err := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
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
		log.Fatal("WS Dial:", err)
	}
	return conn
}
