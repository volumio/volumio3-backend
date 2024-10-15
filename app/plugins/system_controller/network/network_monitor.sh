#!/bin/bash

# Function to check network status using ifconfig
check_network_status() {
    # Check Ethernet connection status (e.g., eth0 or enp0s3)
    ethernet_status=$(ifconfig | grep -E '^(eth|enp)' -A1 | grep 'inet ')
    
    # Check WiFi connection status (e.g., wlan0 or wlp3s0)
    wifi_status=$(ifconfig | grep -E '^(wlan|wlp)' -A1 | grep 'inet ')

    # Extract WiFi IP address (if any)
    wifi_ip=$(ifconfig | grep -E '^(wlan|wlp)' -A1 | grep 'inet ' | awk '{print $2}')

    # Check if WiFi IP is 192.168.211.1 (not considered connected)
    if [[ "$wifi_ip" == "192.168.211.1" ]]; then
        wifi_status=""
    fi

    # Logic to determine network connection status and output as a number
    if [ -n "$ethernet_status" ] && [ -n "$wifi_status" ]; then
        echo "3"  # Connected to both WiFi + Ethernet
    elif [ -n "$ethernet_status" ]; then
        echo "1"  # Connected to Ethernet
    elif [ -n "$wifi_status" ]; then
        echo "2"  # Connected to WiFi
    else
        echo "0"  # Not connected to a network
    fi
}

# Loop to check network status every 10 seconds
while true; do
    check_network_status
    sleep 10
done

