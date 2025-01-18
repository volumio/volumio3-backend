#!/bin/sh

# Unmute Master Playback ZC for Audio Injector Stereo; card 2 on RPi
amixer -c 2 sset 'Master Playback ZC' unmute

# Unmute Output Mixer HiFi Audio Injector Stereo; card 2 on RPi
amixer -c 2 sset 'Output Mixer HiFi' unmute
