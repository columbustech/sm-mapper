package main

import (
	"net/http"
)

func main() {
	http.HandleFunc("/no-of-pods", getNoOfPods)
	http.HandleFunc("/create-map-functions", createMapFns)
	http.HandleFunc("/fn-status", getFnStatus)
	http.HandleFunc("/delete-map-functions", deleteMapFns)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(err)
	}
}
