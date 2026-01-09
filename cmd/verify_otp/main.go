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
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000)) // Random phone
	pin := "123456"

	// 1. Send OTP
	log.Println("--- TEST 1: SEND OTP ---")
	sendOTP(phone)

	// 2. Verify OTP (using mock code "123456")
	log.Println("--- TEST 2: VERIFY OTP ---")
	token := verifyOTP(phone, "123456")
	log.Printf("Verification Token: %s...", token[:20])

	// 3. Register (with token)
	log.Println("--- TEST 3: REGISTER ---")
	register(token, "OTP User", pin)

	// 4. Send OTP (Login attempt)
	log.Println("--- TEST 4: SEND OTP (LOGIN) ---")
	sendOTP(phone)

	// 5. Verify OTP (Login attempt)
	log.Println("--- TEST 5: VERIFY OTP (LOGIN) ---")
	loginToken := verifyOTP(phone, "123456")

	// 6. Login (with token)
	log.Println("--- TEST 6: LOGIN ---")
	login(loginToken, pin)

	log.Println("ALL TESTS PASSED")
}

func sendOTP(phone string) {
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Send OTP Failed: %s", body)
	}
	log.Println("OTP Sent Successfully")
}

func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/verify", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Verify OTP Failed: %s", body)
	}

	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)
	return res["verification_token"]
}

func register(token, name, pin string) {
	payload := map[string]string{
		"verification_token": token,
		"name":               name,
		"password":           pin,
	}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Register Failed: %s", body)
	}
	log.Println("Register Successful")
}

func login(token, pin string) {
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
	log.Println("Login Successful")
}
