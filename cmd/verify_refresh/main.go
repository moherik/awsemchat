package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"time"
)

const baseURL = "http://localhost:8080/api/v1"

func main() {
	rand.Seed(time.Now().UnixNano())
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"

	// 1. Setup User (OTP -> Register)
	// We don't need the registration token for login, we need a NEW one.
	setupUser(phone, pin)

	// 2. Login to get Refresh Token
	log.Println("--- TEST: LOGIN & GET REFRESH TOKEN ---")
	// Send/Verify OTP again for Login
	loginToken := getLoginToken(phone)
	accessToken, refreshToken := login(loginToken, pin)
	log.Printf("Access Token: %s...", accessToken[:10])
	log.Printf("Refresh Token: %s...", refreshToken[:10])

	if refreshToken == "" {
		log.Fatal("FAILED: No refresh token returned")
	}

	// 3. Use Refresh Token to get new Access Token
	log.Println("--- TEST: REFRESH ACCESS TOKEN ---")
	newAccessToken := refresh(refreshToken)
	log.Printf("New Access Token: %s...", newAccessToken[:10])

	if newAccessToken == "" {
		log.Fatal("FAILED: No new access token returned")
	}

	if newAccessToken == accessToken {
		log.Println("WARNING: New token matches old token (This is fine if expiry not encoded in signature part or if too fast, but usually they differ due to iat/exp)")
	} else {
		log.Println("SUCCESS: Token rotated")
	}

	log.Println("ALL TESTS PASSED")
}

func setupUser(phone, pin string) string {
	// Send OTP
	code := sendOTP(phone)
	log.Printf("Got Debug OTP: %s", code)

	// Verify OTP
	token := verifyOTP(phone, code)

	// Register
	register(token, "Refresh User", pin)

	return token // Verification token, can reuse for login or just login with it?
	// Wait, Login needs a fresh verification token sometimes?
	// No, Login deletes OTP? No, VerifyOTP marks as inactive.
	// To Login, I need a NEW verification token potentially if the old one expired or logic requires new OTP.
	// Currently Login requires `verification_token`.
	// For this test, I'll generate a NEW OTP/Token for Login.
}

func getLoginToken(phone string) string {
	code := sendOTP(phone)
	return verifyOTP(phone, code)
}

// ... I need to copy helper functions but update SendOTP to capture code ...

func sendOTP(phone string) string { // Returns code
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res map[string]string
	json.Unmarshal(body, &res)

	if resp.StatusCode != 200 {
		log.Fatalf("Send OTP Failed: %s", body)
	}
	return res["debug_code"]
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
	if resp.StatusCode != 200 {
		log.Fatalf("Verify Failed: %v", res)
	}
	return res["verification_token"]
}

func register(token, name, pin string) {
	payload := map[string]string{
		"verification_token": token,
		"name":               name,
		"password":           pin,
	}
	jsonPayload, _ := json.Marshal(payload)
	http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
}

func login(token, pin string) (string, string) {
	payload := map[string]string{
		"verification_token": token,
		"password":           pin,
	}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Login Failed: %s", body)
	}

	var res struct {
		Token        string `json:"token"`
		RefreshToken string `json:"refresh_token"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	return res.Token, res.RefreshToken
}

func refresh(refreshToken string) string {
	payload := map[string]string{"refresh_token": refreshToken}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/token/refresh", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Refresh Failed: %s", body)
	}

	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)
	return res["token"]
}
