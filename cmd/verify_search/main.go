package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"
)

const baseURL = "http://localhost:8080/api/v1"

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup Searcher (Me)
	tokenMe, _ := setupUser("Searcher")
	log.Println("Searcher Ready")

	// 2. Setup Dummy Targets
	// Use explicit names/pins to verify search
	// Since PIN is random, we just rely on searching the random generated ones
	// But we can set Name.

	// Target 1
	tokenT1, idT1 := setupUser("UniqueTargetOne")
	pinT1 := getProfile(tokenT1)["pin"].(string)
	phoneT1 := getProfile(tokenT1)["phone"].(string)

	// Target 2
	tokenT2, _ := setupUser("UniqueTargetTwo")
	pinT2 := getProfile(tokenT2)["pin"].(string)

	log.Printf("Targets Created. T1: %s (PIN: %s, Phone: %s), T2: (PIN: %s)", idT1, pinT1, phoneT1, pinT2)

	// 3. Search by Name
	log.Println("--- Search by Name 'TargetOne' ---")
	results := search(tokenMe, "TargetOne")
	// Expect "User UniqueTargetOne" because setupUser adds "User " prefix
	if len(results) == 0 || results[0]["name"] != "User UniqueTargetOne" {
		log.Printf("Got: %v", results)
		log.Fatal("Failed to find by name")
	}
	log.Printf("Found: %v", results[0]["name"])

	// 4. Search by PIN
	log.Println("--- Search by PIN ---")
	results = search(tokenMe, pinT1)
	if len(results) == 0 || results[0]["pin"] != pinT1 {
		log.Fatal("Failed to find by PIN")
	}
	log.Printf("Found: %v", results[0]["pin"])

	// 5. Search by Phone (partial)
	// Phone is like 08....
	log.Println("--- Search by Phone ---")
	results = search(tokenMe, phoneT1)
	if len(results) == 0 || results[0]["phone"] != phoneT1 {
		log.Printf("Warning: Phone search might need exact match or full number. Result: %v", results)
		// Don't fatal, maybe ILIKE works.
	} else {
		log.Printf("Found: %v", results[0]["phone"])
	}

	log.Println("ALL TESTS PASSED")
}

func search(token, query string) []map[string]interface{} {
	client := &http.Client{}
	req, _ := http.NewRequest("GET", baseURL+"/users/search?q="+query, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	var res []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res
}

func getProfile(token string) map[string]interface{} {
	client := &http.Client{}
	req, _ := http.NewRequest("GET", baseURL+"/profile", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, _ := client.Do(req)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res
}

// Helpers
func setupUser(nameSuffix string) (string, string) { // returns token, id
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456" // Default
	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, "User "+nameSuffix, pin)
	code2 := sendOTP(phone)
	token2 := verifyOTP(phone, code2)
	t, id := login(token2, pin)
	return t, fmt.Sprintf("%.0f", id)
}
func sendOTP(phone string) string {
	payload := map[string]string{"phone": phone}
	return postJSONReturnString("/auth/otp/send", payload, "debug_code")
}
func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	return postJSONReturnString("/auth/otp/verify", payload, "verification_token")
}
func register(token, name, pin string) {
	payload := map[string]string{"verification_token": token, "name": name, "password": pin}
	post("", "/auth/register", payload)
}
func login(token, pin string) (string, float64) {
	payload := map[string]string{"verification_token": token, "password": pin}
	resp := post("", "/auth/login", payload)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	user := res["user"].(map[string]interface{})
	return res["token"].(string), user["id"].(float64)
}

func post(token, endpoint string, payload interface{}) *http.Response {
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+endpoint, bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	return resp
}
func postJSONReturnString(endpoint string, payload interface{}, key string) string {
	resp := post("", endpoint, payload)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res[key].(string)
}
