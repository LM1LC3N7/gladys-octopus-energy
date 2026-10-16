# Octopus Energy (UK)

**Unofficial connector, not affiliated with Octopus Energy.** It brings your
Octopus Energy account (Great Britain) into Gladys: your electricity and gas
meters, their half-hourly consumption in the Gladys energy monitoring, your
current unit rate and standing charge, and the public **Agile** prices with
"cheapest hours" scene triggers. Octopus Energy is a trademark of Octopus
Energy Group. For Octopus Energy **France**, use the Octopus Energy France
integration instead: this one only talks to the British API.

## What you get

| Surface                                           | Content                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per **electricity** meter point (MPAN) | the 30-minute consumption for the energy monitoring, the unit rate now (£/kWh, VAT included) and the standing charge (£/day)                                            |
| One device per **gas** meter point (MPRN)         | the same, the gas consumption converted to kWh                                                                                                                          |
| One **Agile region** device                       | Agile price now, next price, today's average, minimum and maximum, a "cheap period" sensor and a "negative price" sensor                                                |
| Scene triggers                                    | **cheap period started / ended** (the N cheapest hours of the day), **negative price started** (plunge pricing), **tomorrow's prices published** (around 16:00 UK time) |
| Scene actions                                     | **price now** and **cheapest hours** (the N cheapest consecutive hours of the next 24 hours, of today or of tomorrow)                                                   |
| Widget                                            | **Octopus prices**: now, next, averages, cheapest hours, negative prices, price curve of today and tomorrow                                                             |
| Energy contracts (Gladys 5.2+)                    | **Octopus Energy electricity** and **gas** templates: each half hour priced at the unit rate of your tariff at that time, plus the standing charge                      |

## Installation

1. In your Octopus dashboard, open
   [API access](https://octopus.energy/dashboard/new/accounts/personal-details/api-access):
   copy the **API key** (`sk_live_…`) and your **account number**
   (`A-XXXXXXXX`).
2. Install the integration, paste both, save, then click **Test the
   connection**: your meters, their tariff and the current Agile price show
   up.
3. Open **Discovery** and add the devices you want (the meters, the Agile
   region).
4. Put the **Octopus prices** widget on a dashboard and pick the Agile region
   (or a meter on a half-hourly tariff).

**Without an Octopus account** leave the key empty and choose an **Agile
prices region**: you get the public Agile device, its triggers and the widget.
With an account, "Automatic" takes the region of your electricity tariff.

## Energy monitoring

Smart meter readings reach Octopus with a delay (often the next day). The
integration therefore publishes **dated** half hours: each reading lands in
its own half hour of the energy monitoring, even when it arrives a day late.
When a meter device is first added, the last 14 days are filled in; then the
last 3 days are read every hour. Gas read in cubic metres (SMETS2) is
converted to kWh with the calorific value of the configuration (×1.02264 ÷
3.6); choose kWh for a SMETS1 gas meter.

To see the costs, create a contract in **Energy monitoring → Contracts** from
the **Octopus Energy electricity** (or **gas**) template, attach it to the
meter device and enter the standing charge shown by the device. Gladys then
asks the integration to price each half hour from your own tariff history,
tariff changes included.

## Scenes

- **Cheap period started / ended**: the current half hour enters or leaves
  the N cheapest hours of the day (N = **Cheap hours per day**, 3 by
  default). Start the dishwasher, the car charger, the hot water.
- **Negative price started**: Agile pays you to use electricity this half
  hour.
- **Tomorrow's prices published**: once a day, with the average, the
  extremes, the number of negative half hours and the cheapest window.

The scene actions give their results to the next actions of the scene, in
their variable list (written `{{<step>.<action>.<key>}}`, for example
`{{0.0.price}}`): **price now** gives `price`, `cheap`, `negative`,
`next_price`, `avg_price`, `window_start_time`…; **cheapest hours** gives
`start_time`, `end_time`, `start` and `end` (ISO dates for a "wait until"),
`minutes_until_start` and the saving against the period.

## Limits

- Great Britain only (Octopus Energy UK API). Germany, Italy and the other
  Kraken countries are not covered.
- Two-rate tariffs (Economy 7) have no single unit rate: their unit rate
  feature stays empty and their contract cannot be priced yet.
- Export meters (solar) are not read yet.
- A negative Agile price is counted as a zero cost in the contracts (Gladys
  costs cannot be negative).
- Calls: the account every 6 hours, each meter's consumption and tariff every
  hour, the Agile prices every hour (and every 15 minutes after 16:00 until
  tomorrow's prices are out).

## Troubleshooting

- **"Octopus refused the API key or the account number"**: copy them again
  from the API access page; a key regenerated there replaces the old one.
- **No consumption**: check that the meter device is created; smart meter
  data can take a day or more to reach Octopus.
- **No Agile device**: choose a region, or enter your account so "Automatic"
  can read it from your tariff.
- Logs: set the `LOG_LEVEL` variable of the integration.

## Privacy

The key is stored encrypted by Gladys and sent only to `api.octopus.energy`,
and only for the account and consumption requests (the tariffs and Agile
prices are public). Nothing is logged with the key or the account number.

## Credits

The tariff and meter logic follows
[BottlecapDave/HomeAssistant-OctopusEnergy](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy)
(MIT, © 2021 David Kendall).
