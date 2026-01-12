package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	baseURL = "http://localhost:8080/api/v1"
	wsURL   = "ws://localhost:8080/api/v1/ws"
)

type AuthResponse struct {
	Token    string `json:"token"`
	User     User   `json:"user"`
	DeviceID uint   `json:"device_id"`
}

type User struct {
	ID    uint   `json:"id"`
	Phone string `json:"phone"`
	Name  string `json:"name"`
	PIN   string `json:"pin"`
}

type MessagePayload struct {
	Type       string `json:"type"`
	Content    []byte `json:"content"`
	ReceiverID uint   `json:"receiver_id"`
	SenderID   uint   `json:"sender_id"`
}

func main() {
	// 1. Register/Login User A (Device 1)
	tokenA1, userA, _ := authenticateUser("08111111111", "111111", "User A", "dev-uuid-1", "Phone")
	fmt.Printf("User A (Phone) Logged In. DeviceID: ?\n")
	tokenA1, userA, deviceIDA1 := authenticateUser("08111111111", "111111", "User A", "dev-uuid-1", "Phone")
	fmt.Printf("User A (Phone) Logged In. DeviceID: %d\n", deviceIDA1)

	// 2. Register/Login User A (Device 2)
	tokenA2, _, deviceIDA2 := authenticateUser("08111111111", "111111", "User A", "dev-uuid-2", "Desktop")
	fmt.Printf("User A (Desktop) Logged In. DeviceID: %d\n", deviceIDA2)

	// 3. Register/Login User B
	tokenB, _, deviceIDB := authenticateUser("08222222222", "222222", "User B", "dev-uuid-3", "Phone B")
	fmt.Printf("User B Logged In. DeviceID: %d\n", deviceIDB)

	// 4. Connect A1
	connA1 := connectWS(tokenA1)
	defer connA1.Close()
	fmt.Println("User A (Phone) Connected WS")

	// 5. Connect A2
	connA2 := connectWS(tokenA2)
	defer connA2.Close()
	fmt.Println("User A (Desktop) Connected WS")

	// 6. Connect B
	connB := connectWS(tokenB)
	defer connB.Close()
	fmt.Println("User B Connected WS")

	// 7. B sends message to A
	msgContent := []byte("Hello Multi-Device World")
	msg := MessagePayload{
		Type:       "text",
		Content:    msgContent,
		ReceiverID: userA.ID,
	}
	err := connB.WriteJSON(msg)
	if err != nil {
		log.Fatal("Failed to send message:", err)
	}
	fmt.Println("User B sent message to A")

	// 8. Verify A1 received
	verifyMessage(connA1, "User A (Phone)")

	// 9. Verify A2 received
	verifyMessage(connA2, "User A (Desktop)")

	fmt.Println("SUCCESS: Multi-Device Verification Passed!")
}

func authenticateUser(phone, pin, name, deviceUUID, deviceName string) (string, User, uint) {
	// 1. Send OTP
	postJSON(baseURL+"/auth/otp/send", map[string]string{"phone": phone})

	// 2. Verify OTP
	// respCode := postJSON(baseURL+"/auth/otp/verify", map[string]string{"phone": phone, "code": "mock-code"}) // Assuming mock is ignored or static? actually we need real code if logic is robust.
	// But in dev mode/mock we might have fixed code or need to read DB.
	// Wait, standard SendOTP generates random code.
	// I need to use `Login` if user exists, else `Register`.
	// For simplicity, let's assume Register first.

	// To bypass OTP randomness in blackbox test, we can use a known user if verified previously?
	// Or relies on "debug_code" if enabled?
	// My SendOTP modification commented out log.
	// However, I can try to Login directly if user exists.

	// Let's assume User Exists or try Registering.
	// Issue: I can't easily get OTP.
	// SOLUTION: Use a backdoor or modify main test to use existing tokens if possible?
	// OR: Just assume valid inputs for `VerifyOTP`?
	// Ah, I see `SendOTP` implementation:
	// log.Printf("SMS sent to %s: %s", req.Phone, code) is commented out.
	// BUT `return c.JSON(http.StatusOK, map[string]string{"message": "OTP sent", "debug_code": code})`
	// It returns `debug_code` in response!

	var sendOtpResp struct {
		DebugCode string `json:"debug_code"`
	}
	rawResp := postGetBody(baseURL+"/auth/otp/send", map[string]string{"phone": phone})
	json.Unmarshal(rawResp, &sendOtpResp)

	// Verify
	var verifyResp struct {
		VerificationToken string `json:"verification_token"`
	}
	rawVerify := postGetBody(baseURL+"/auth/otp/verify", map[string]string{"phone": phone, "code": sendOtpResp.DebugCode})
	json.Unmarshal(rawVerify, &verifyResp)

	// Register or Login
	authBody := map[string]string{
		"verification_token": verifyResp.VerificationToken,
		"password":           pin,
		"device_uuid":        deviceUUID,
		"device_name":        deviceName,
	}

	// Try Register
	authBody["name"] = name
	rawAuth := postGetBody(baseURL+"/auth/register", authBody)

	// If 500/Fail (likely duplicate), try Login
	// Better: Check response status?
	// `postGetBody` just returns body.

	var authResp AuthResponse
	json.Unmarshal(rawAuth, &authResp)

	if authResp.Token == "" {
		// Try Login
		delete(authBody, "name")
		rawAuth = postGetBody(baseURL+"/auth/login", authBody)
		json.Unmarshal(rawAuth, &authResp)
	}

	if authResp.Token == "" {
		log.Fatalf("Auth failed for %s. Resp: %s", phone, string(rawAuth))
	}

	return authResp.Token, authResp.User, authResp.DeviceID
}

func connectWS(token string) *websocket.Conn {
	// Using Query Param for Token
	url := fmt.Sprintf("%s?token=%s", wsURL, token)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatalf("WS Connect failed: %v", err)
	}
	return conn
}

func verifyMessage(conn *websocket.Conn, clientName string) {
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		log.Fatalf("%s failed to receive message: %v", clientName, err)
	}

	var payload MessagePayload
	json.Unmarshal(msg, &payload)

	if payload.Type == "text" && string(payload.Content) == "Hello Multi-Device World" {
		fmt.Printf("%s Received Message OK\n", clientName)
	} else {
		log.Fatalf("%s Received unexpected message: %+v", clientName, payload)
	}
}

func postJSON(url string, data interface{}) {
	postGetBody(url, data)
}

func postGetBody(url string, data interface{}) []byte {
	jsonData, _ := json.Marshal(data)
	resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Fatalf("Post failed: %v", err)
	}
	defer resp.Body.Close()
	body, _ := ioutil.ReadAll(resp.Body)
	return body
}
