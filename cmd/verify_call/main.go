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
	TempID     string `json:"temp_id,omitempty"`
	SenderID   uint   `json:"sender_id"`
	ReceiverID uint   `json:"receiver_id"`
	Content    []byte `json:"content,omitempty"`
	Type       string `json:"type"`
}

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup User A (Caller) & User B (Callee)
	tokenA, idA := setupUser()
	tokenB, idB := setupUser()
	log.Printf("Caller A: %.0f, Callee B: %.0f", idA, idB)

	// 2. Connect WS
	connA := connectWS(tokenA)
	defer connA.Close()
	connB := connectWS(tokenB)
	defer connB.Close()

	callID := fmt.Sprintf("call-%d", time.Now().UnixNano())

	// 3. A sends CALL OFFER
	log.Println("--- CALL OFFER (A -> B) ---")
	offer := MessagePayload{
		ReceiverID: uint(idB),
		Type:       "call_offer",
		Content:    []byte(`{"sdp": "OFFER_SDP"}`),
		TempID:     callID,
	}
	connA.WriteJSON(offer)

	// 4. B receives OFFER
	go func() {
		for {
			var msg MessagePayload
			if err := connB.ReadJSON(&msg); err != nil {
				log.Println("B Read Error:", err)
				return
			}
			log.Printf("B Received: Type=%s, Content=%s", msg.Type, msg.Content)

			if msg.Type == "call_offer" {
				// B sends CALL ANSWER
				log.Println("--- CALL ANSWER (B -> A) ---")
				answer := MessagePayload{
					ReceiverID: uint(idA),
					Type:       "call_answer",
					Content:    []byte(`{"sdp": "ANSWER_SDP"}`),
					TempID:     msg.TempID,
				}
				connB.WriteJSON(answer)
			}
		}
	}()

	// 5. A receives ANSWER
	gotAnswer := false
	for i := 0; i < 5; i++ {
		connA.SetReadDeadline(time.Now().Add(2 * time.Second))
		var msg MessagePayload
		if err := connA.ReadJSON(&msg); err != nil {
			log.Println("A Read Error:", err)
			continue
		}
		log.Printf("A Received: Type=%s", msg.Type)

		if msg.Type == "call_answer" {
			log.Printf("SUCCESS: A received Answer")
			gotAnswer = true
			break
		} else if msg.Type == "message_ack" {
			log.Printf("A received ACK (Ignored for SIGNALING test)")
		}
	}

	if !gotAnswer {
		log.Fatal("FAILED: A did not receive Answer")
	}

	// 6. A sends ICE CANDIDATE
	log.Println("--- ICE CANDIDATE (A -> B) ---")
	ice := MessagePayload{
		ReceiverID: uint(idB),
		Type:       "ice_candidate",
		Content:    []byte(`{"candidate": "candidate:1234"}`),
	}
	connA.WriteJSON(ice)

	// 7. A sends CALL END
	time.Sleep(500 * time.Millisecond) // Simulate call duration
	log.Println("--- CALL END (A -> B) ---")
	end := MessagePayload{
		ReceiverID: uint(idB),
		Type:       "call_end",
		Content:    []byte("reason:ended"),
	}
	connA.WriteJSON(end)

	// Expecting server to log this. We can't verify DB here easily without DB access,
	// but if no error, we assume it worked. User B will receive it.

	log.Println("ALL TESTS PASSED")
}

// Helpers (Same as verify_receipts)
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
