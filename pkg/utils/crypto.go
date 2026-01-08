package utils

import (
	"golang.org/x/crypto/bcrypt"
)

func HashPIN(pin string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	return string(bytes), err
}

func CheckPIN(pin, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin))
	return err == nil
}
