#!/bin/sh

### BASSOWL-HAT I2C ADDRESS
TAS_ADDR=0x4c



echo "INIT BASSOWL-HAT"

sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00
sudo i2cset -y 1 $TAS_ADDR 0x03 0x02
sudo i2cset -y 1 $TAS_ADDR 0x01 0x11
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00

sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7d 0x11
sudo i2cset -y 1 $TAS_ADDR 0x7e 0xff
sudo i2cset -y 1 $TAS_ADDR 0x00 0x01
sudo i2cset -y 1 $TAS_ADDR 0x51 0x05
sudo i2cset -y 1 $TAS_ADDR 0x00 0x02
sudo i2cset -y 1 $TAS_ADDR 0x1d 0x00
sudo i2cset -y 1 $TAS_ADDR 0x19 0x80
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00
sudo i2cset -y 1 $TAS_ADDR 0x46 0x11
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x02 0x00
sudo i2cset -y 1 $TAS_ADDR 0x53 0x01
sudo i2cset -y 1 $TAS_ADDR 0x54 0x07    # Analog gain of -3.05dB (19.73 Vpeak)
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00
sudo i2cset -y 1 $TAS_ADDR 0x03 0x02

## Register Tuning
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00    # Page 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00    # Book 0x00
sudo i2cset -y 1 $TAS_ADDR 0x30 0x00    # SDOUT is the DSP output
sudo i2cset -y 1 $TAS_ADDR 0x60 0x02
sudo i2cset -y 1 $TAS_ADDR 0x62 0x09
sudo i2cset -y 1 $TAS_ADDR 0x4c 0x30    # Digital volume 0dB
sudo i2cset -y 1 $TAS_ADDR 0x03 0x03
sudo i2cset -y 1 $TAS_ADDR 0x00 0x00    # Page 0x00
sudo i2cset -y 1 $TAS_ADDR 0x7f 0x00    # Book 0x00
sudo i2cset -y 1 $TAS_ADDR 0x78 0x80    # Clear analog fault

echo "BASSOWL-HAT INIT DONE!"