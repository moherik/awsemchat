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
	baseURL   = "http://localhost:8080/api/v1"
	authWsURL = "ws://localhost:8080/api/v1/auth/ws"
	mainWsURL = "ws://localhost:8080/api/v1/ws"
)

type AuthResponse struct {
	Token    string `json:"token"`
	DeviceID uint   `json:"device_id"`
}

type LinkPayload struct {
	Type  string      `json:"type"`
	Code  string      `json:"code"`
	Token string      `json:"token"` // in auth response
	User  interface{} `json:"user"`
}

func main() {
	// 1. Web Client connects to Auth WS
	webConn, _, err := websocket.DefaultDialer.Dial(authWsURL, nil)
	if err != nil {
		log.Fatalf("Web Client failed to connect: %v", err)
	}
	defer webConn.Close()
	fmt.Println("Web Client Connected to Auth WS")

	// 2. We should receive QR Code
	var qrMsg LinkPayload
	webConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := webConn.ReadJSON(&qrMsg); err != nil {
		log.Fatalf("Failed to read QR: %v", err)
	}
	if qrMsg.Type != "qr_code" || qrMsg.Code == "" {
		log.Fatalf("Invalid QR Response: %+v", qrMsg)
	}
	linkCode := qrMsg.Code
	fmt.Printf("Received Link Code: %s\n", linkCode)

	// 3. Phone Client Logs In
	phoneToken, _, _ := authenticateUser("08111111111", "111111", "User A", "dev-phone-1", "Phone")
	fmt.Println("Phone Client Logged In")

	// 4. Phone Client Links Device
	linkBody := map[string]string{
		"code":        linkCode,
		"device_name": "Web Browser",
	}
	postJSONWithAuth(baseURL+"/auth/devices/link", linkBody, phoneToken)
	fmt.Println("Phone Client Sent Link Request")

	// 5. Web Client should receive Token
	var authMsg LinkPayload
	webConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := webConn.ReadJSON(&authMsg); err != nil {
		log.Fatalf("Web Client receive failed: %v", err)
	}

	// Check if we received the token structure (LinkPayload is generic here, assumes fields match)
	// Actually AuthorizeSession sends `AuthResponse` struct.
	// So `authMsg` must match `AuthResponse` somewhat?
	// Wait, `AuthorizeSession` sends `authPayload` which IS `AuthResponse`.
	// My `LinkPayload` struct above is trying to do double duty.
	// Let's decode raw map to be safe.

	// Re-reading as map
	// Note: ReadJSON read into struct.
	// `AuthResponse` has `Token`. `LinkPayload` has `Token`.
	// But `AuthResponse` does NOT have `type`.
	// `AuthorizeSession` sends raw `AuthResponse`.
	// So `authMsg.Type` will be empty.

	if authMsg.Token == "" {
		log.Fatalf("Web Client did NOT receive token. Msg: %+v", authMsg)
	}
	webToken := authMsg.Token
	fmt.Printf("Web Client Received Token: %s...\n", webToken[:10])

	// 6. Web Client connects to Main WS
	mainConn := connectWS(webToken)
	defer mainConn.Close()
	fmt.Println("Web Client Successfully Connected to Main WS!")

	fmt.Println("SUCCESS: Device Linking Verified!")
}

func authenticateUser(phone, pin, name, deviceUUID, deviceName string) (string, interface{}, uint) {
	// Send OTP
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

	// Register/Login
	authBody := map[string]string{
		"verification_token": verifyResp.VerificationToken,
		"password":           pin,
		"device_uuid":        deviceUUID,
		"device_name":        deviceName,
		"name":               name,
	}

	// Try Register
	rawAuth := postGetBody(baseURL+"/auth/register", authBody)
	var authResp AuthResponse
	json.Unmarshal(rawAuth, &authResp)

	if authResp.Token == "" {
		// Try Login
		delete(authBody, "name")
		rawAuth = postGetBody(baseURL+"/auth/login", authBody)
		json.Unmarshal(rawAuth, &authResp)
	}

	if authResp.Token == "" {
		log.Fatalf("Auth failed: %s", string(rawAuth))
	}

	return authResp.Token, nil, authResp.DeviceID
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

func postJSONWithAuth(url string, data interface{}, token string) {
	jsonData, _ := json.Marshal(data)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("PostWithAuth failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := ioutil.ReadAll(resp.Body)
		log.Fatalf("PostWithAuth Error %d: %s", resp.StatusCode, string(body))
	}
}

func connectWS(token string) *websocket.Conn {
	url := fmt.Sprintf("%s?token=%s", mainWsURL, token)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatalf("WS Connect failed: %v", err)
	}
	return conn
}
