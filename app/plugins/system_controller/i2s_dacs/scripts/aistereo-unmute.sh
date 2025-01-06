#!/bin/sh

# Unmute Master Playback ZC; card 2 on RPi
amixer -c 2 sset 'Master Playback ZC' unmute

# Unmute Output Mixer HiFi; card 2 on RPi
amixer -c 2 sset 'Output Mixer HiFi' unmute
