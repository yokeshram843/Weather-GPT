let weatherMap = L.map("weatherMap").setView([20.5937, 78.9629], 5);
let weatherMarker;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(weatherMap);

/* Retries a fetch once after a short delay if the first attempt fails or
   returns a server/rate-limit error (429, 502, 503). This absorbs the
   occasional transient blip from Open-Meteo's free tier without needing
   the user to manually search again. Client errors (4xx other than 429)
   are not retried since retrying won't fix a bad request. */
async function fetchWithRetry(url, retries = 1, delayMs = 800) {
    try {
        const response = await fetch(url);

        if (!response.ok && retries > 0 &&
            (response.status === 429 || response.status >= 500)) {
            await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
            return fetchWithRetry(url, retries - 1, delayMs);
        }

        return response;
    } catch (networkError) {
        if (retries > 0) {
            await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
            return fetchWithRetry(url, retries - 1, delayMs);
        }
        throw networkError;
    }
}

async function searchWeather(cityFromUrl = "") {
    const searchButton = document.querySelector(".weather-search button");

    if (searchButton) {
        searchButton.textContent = "Loading...";
        searchButton.disabled = true;
    }

    const input = document.querySelector(".weather-search input");
    const city = cityFromUrl || (input ? input.value.trim() : "");

    if (city === "") {
        alert("Please enter a city name");

        if (searchButton) {
            searchButton.textContent = "Search Weather";
            searchButton.disabled = false;
        }

        return;
    }

    try {
        const locationResponse = await fetchWithRetry(
            "https://geocoding-api.open-meteo.com/v1/search?name=" +
            encodeURIComponent(city) +
            "&count=1&language=en&format=json"
        );

        if (!locationResponse.ok) {
            throw new Error(
                "Location API error (status " + locationResponse.status + ")"
            );
        }

        const locationData = await locationResponse.json();

        if (!locationData.results || locationData.results.length === 0) {
            alert("Location not found. Please check the spelling and try again.");
            return;
        }

        const location = locationData.results[0];

        const latitude = location.latitude;
        const longitude = location.longitude;

        weatherMap.setView([latitude, longitude], 10);

        if (weatherMarker) {
            weatherMap.removeLayer(weatherMarker);
        }

        weatherMarker = L.marker([latitude, longitude]).addTo(weatherMap);

        const actualCityName = location.name || city;

        const weatherResults = document.getElementById("weatherResults");

        if (weatherResults) {
            weatherResults.style.display = "block";
        }

        const weatherResponse = await fetchWithRetry(
            "https://api.open-meteo.com/v1/forecast?latitude=" +
            latitude +
            "&longitude=" +
            longitude +
            "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure" +
            "&timezone=auto"
        );

        if (!weatherResponse.ok) {
            throw new Error(
                "Weather API error (status " + weatherResponse.status + ")"
            );
        }

        const weatherData = await weatherResponse.json();

        if (!weatherData.current) {
            throw new Error("Current weather data unavailable");
        }

        const current = weatherData.current;

        const temperature = current.temperature_2m;
        const humidity = current.relative_humidity_2m;
        const windSpeed = current.wind_speed_10m;
        const feelsLike = current.apparent_temperature;
        const weatherCode = current.weather_code;
        const visibility = current.visibility;
        const pressure = current.surface_pressure;

        window.currentTemperature = temperature;
        window.currentHumidity = humidity;
        window.currentWindSpeed = windSpeed;
        window.currentFeelsLike = feelsLike;
        window.currentCity = actualCityName;
        window.currentWeatherCode = weatherCode;

        const condition = getWeatherCondition(weatherCode);

        const cityName = document.querySelector("#cityName");
        const temperatureElement = document.querySelector("#temperature");
        const conditionElement = document.querySelector("#condition");
        const humidityElement = document.querySelector("#humidity");
        const windElement = document.querySelector("#windSpeed");
        const feelsLikeElement = document.querySelector("#feelsLike");

        if (cityName) {
            cityName.textContent = actualCityName;
        }

        if (temperatureElement) {
            temperatureElement.textContent = temperature + "°C";
        }

        if (conditionElement) {
            conditionElement.textContent = condition;
        }

        if (humidityElement) {
            humidityElement.textContent = humidity + "%";
        }

        if (windElement) {
            windElement.textContent = windSpeed + " km/h";
        }

        if (feelsLikeElement) {
            feelsLikeElement.textContent = feelsLike + "°C";
        }

        const visibilityElement = document.querySelector("#visibility");

        if (visibilityElement) {
            if (visibility !== undefined && visibility !== null) {
                visibilityElement.textContent =
                    (visibility / 1000).toFixed(1) + " km";
            } else {
                visibilityElement.textContent = "-- km";
            }
        }

        const pressureElement = document.querySelector("#pressure");

        if (pressureElement) {
            if (pressure !== undefined && pressure !== null) {
                pressureElement.textContent =
                    Math.round(pressure) + " hPa";
            } else {
                pressureElement.textContent = "-- hPa";
            }
        }

        await getForecast(latitude, longitude);

        updateWeatherRisk();

        updateWeatherAlert(weatherCode, actualCityName);

    } catch (error) {
        console.error("Weather Error:", error);
        alert(
            "Unable to get weather data (" + error.message + "). " +
            "This is usually temporary — please try again in a few seconds."
        );
    } finally {
        if (searchButton) {
            searchButton.textContent = "Search Weather";
            searchButton.disabled = false;
        }
    }
}

async function getForecast(latitude, longitude) {
    try {
        const response = await fetchWithRetry(
            "https://api.open-meteo.com/v1/forecast?" +
            "latitude=" + latitude +
            "&longitude=" + longitude +
            "&daily=" +
            "temperature_2m_max," +
            "temperature_2m_min," +
            "weather_code," +
            "precipitation_probability_max" +
            "&forecast_days=7" +
            "&timezone=auto"
        );

        if (!response.ok) {
            throw new Error("Forecast API error");
        }

        const data = await response.json();

        if (!data.daily) {
            throw new Error("Forecast data unavailable");
        }

        window.tomorrowMaxTemperature =
            data.daily.temperature_2m_max[1];

        window.tomorrowRainProbability =
            data.daily.precipitation_probability_max[1];

        const rainProbability =
            data.daily.precipitation_probability_max[0];

        window.currentRainProbability =
            rainProbability;

        const rainAlert =
            document.querySelector("#rainAlert");

        if (rainAlert) {
            rainAlert.textContent =
                "Rain Probability: " + rainProbability + "%";
        }

        updateRainAlertLevel(rainProbability);

        for (let i = 0; i < 7; i++) {
            const forecastDate =
                new Date(data.daily.time[i]);

            const dayElement =
                document.querySelector("#day" + (i + 1));

            const tempElement =
                document.querySelector("#temp" + (i + 1));

            const conditionElement =
                document.querySelector("#condition" + (i + 1));

            const iconElement =
                document.querySelector("#icon" + (i + 1));

            const rainElement =
                document.querySelector("#rain" + (i + 1));

            if (dayElement) {
                if (i === 0) {
                    dayElement.textContent = "Today";
                } else if (i === 1) {
                    dayElement.textContent = "Tomorrow";
                } else {
                    dayElement.textContent =
                        forecastDate.toLocaleDateString(
                            "en-US",
                            {
                                weekday: "short"
                            }
                        );
                }
            }

            if (tempElement) {
                tempElement.textContent =
                    data.daily.temperature_2m_max[i] + "°C";
            }

            const condition =
                getWeatherCondition(
                    data.daily.weather_code[i]
                );

            if (conditionElement) {
                conditionElement.textContent =
                    condition;
            }

            const icon =
                getWeatherIcon(
                    data.daily.weather_code[i]
                );

            if (iconElement) {
                iconElement.textContent =
                    icon;
            }

            const dailyRain =
                data.daily.precipitation_probability_max[i];

            if (rainElement) {
                rainElement.textContent =
                    "Rain: " + dailyRain + "%";
            }
        }

    } catch (error) {
        console.error("Forecast Error:", error);

        const rainAlert =
            document.querySelector("#rainAlert");

        if (rainAlert) {
            rainAlert.textContent =
                "Rain Probability: --%";
        }
    }
}

function getWeatherCondition(code) {
    if (code === 0) return "Clear Sky";

    if (code === 1 || code === 2 || code === 3)
        return "Partly Cloudy";

    if (code === 45 || code === 48)
        return "Foggy";

    if (code >= 51 && code <= 57)
        return "Drizzle";

    if (code >= 61 && code <= 67)
        return "Rain";

    if (code >= 71 && code <= 77)
        return "Snow";

    if (code >= 80 && code <= 82)
        return "Rain Showers";

    if (code >= 95)
        return "Thunderstorm";

    return "Unknown";
}

function getWeatherIcon(code) {
    if (code === 0) return "☀️";

    if (code === 1 || code === 2)
        return "🌤️";

    if (code === 3)
        return "☁️";

    if (code === 45 || code === 48)
        return "🌫️";

    if (code >= 51 && code <= 57)
        return "🌦️";

    if (code >= 61 && code <= 67)
        return "🌧️";

    if (code >= 71 && code <= 77)
        return "❄️";

    if (code >= 80 && code <= 82)
        return "🌧️";

    if (code >= 95)
        return "⛈️";

    return "🌤️";
}

function updateRainAlertLevel(rainProbability) {
    const element =
        document.querySelector("#alertLevel");

    if (!element) return;

    let alertLevel = "Normal";

    if (rainProbability >= 81) {
        alertLevel = "Very High";
        element.style.backgroundColor = "#f8d7da";
        element.style.color = "#842029";

    } else if (rainProbability >= 61) {
        alertLevel = "High";
        element.style.backgroundColor = "#fff3cd";
        element.style.color = "#664d03";

    } else if (rainProbability >= 31) {
        alertLevel = "Moderate";
        element.style.backgroundColor = "#cff4fc";
        element.style.color = "#055160";

    } else {
        alertLevel = "Normal";
        element.style.backgroundColor = "#d1e7dd";
        element.style.color = "#0f5132";
    }

    element.textContent =
        "Alert Level: " + alertLevel;
}

function updateWeatherAlert(weatherCode, city) {
    const alertTitle =
        document.querySelector("#alertTitle");

    const alertMessage =
        document.querySelector("#alertMessage");

    const alertIcon =
        document.querySelector(".alert-icon");

    const rainProbability =
        window.currentRainProbability;

    if (!alertTitle || !alertMessage)
        return;

    if (rainProbability >= 80) {
        alertTitle.textContent =
            "🌧️ Heavy Rain Alert";

        alertMessage.textContent =
            "Very high rain probability of " +
            rainProbability +
            "% is expected in " +
            city +
            ". Carry an umbrella and avoid unnecessary travel.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else if (weatherCode >= 95) {
        alertTitle.textContent =
            "⛈️ Severe Weather Alert";

        alertMessage.textContent =
            "Thunderstorm conditions are currently detected in " +
            city +
            ". Please stay alert and follow local weather guidance.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else if (rainProbability >= 50) {
        alertTitle.textContent =
            "🌦️ Rain Possibility";

        alertMessage.textContent =
            "There is a " +
            rainProbability +
            "% chance of rain in " +
            city +
            " today. Consider carrying an umbrella.";

        if (alertIcon) {
            alertIcon.textContent = "⚠️";
        }

    } else {
        alertTitle.textContent =
            "✅ No Active Alerts";

        alertMessage.textContent =
            "There are currently no severe weather alerts for " +
            city +
            ".";

        if (alertIcon) {
            alertIcon.textContent = "✅";
        }
    }
}
function askWeatherGPT() {
    const input = document.querySelector("#chatInput");

    if (!input) return;

    const question = input.value.trim();

    if (question === "") {
        alert("Please ask a question!");
        return;
    }

    if (!window.currentCity) {
        const response = document.querySelector("#chatResponse");

        if (response) {
            response.textContent =
                "Please search for a city first, then ask me about its weather.";
        }

        return;
    }

    const lowerQuestion = question.toLowerCase();

    const isTamil = /[\u0B80-\u0BFF]/.test(question);

    const hasAny = (...words) =>
        words.some(word => lowerQuestion.includes(word));

    const city = window.currentCity;
    const temperature = window.currentTemperature;
    const humidity = window.currentHumidity;
    const windSpeed = window.currentWindSpeed;
    const feelsLike = window.currentFeelsLike;
    const rainProbability = window.currentRainProbability;
    const tomorrowRain = window.tomorrowRainProbability;
    const tomorrowTemperature = window.tomorrowMaxTemperature;
    const weatherCode = window.currentWeatherCode;

    const conditionElement = document.querySelector("#condition");

    const condition = conditionElement
        ? conditionElement.textContent
        : "Unknown";

    const isTomorrow = hasAny(
        "tomorrow",
        "நாளைக்கு",
        "நாளை",
        "naalaiki",
        "nalaki",
        "nalikku"
    );

    const isRain = hasAny(
        "rain",
        "rainy",
        "mazhai",
        "மழை"
    );

    const isClothes = hasAny(
        "clothes",
        "cloth",
        "dry clothes",
        "drying",
        "laundry",
        "wash clothes",
        "dress",
        "dress-ah",
        "துணி",
        "துணிகளை",
        "காய",
        "காயவைக்க",
        "காயப்போட"
    );

    const isTravel = hasAny(
        "travel",
        "trip",
        "journey",
        "go out",
        "outside",
        "bike",
        "bicycle",
        "college",
        "school",
        "ride",
        "பயணம்",
        "வெளியே",
        "போகலாமா",
        "போகலாம்",
        "கல்லூரி",
        "பைக்",
        "பயணம் போக"
    );

    const isUmbrella = hasAny(
        "umbrella",
        "குடை"
    );

    const isTemperature = hasAny(
        "temperature",
        "temp",
        "hot",
        "heat",
        "வெப்பநிலை",
        "சூடு",
        "வெப்பம்"
    );

    const isHumidity = hasAny(
        "humidity",
        "ஈரப்பதம்"
    );

    const isWind = hasAny(
        "wind",
        "wind speed",
        "காற்று"
    );

    const isFeelsLike = hasAny(
        "feels like",
        "feel like",
        "outside feel",
        "வெளியே எப்படி இருக்கு"
    );

    const isAlert = hasAny(
        "alert",
        "warning",
        "danger",
        "safe",
        "safety",
        "எச்சரிக்கை",
        "ஆபத்து",
        "பாதுகாப்பு"
    );

    const isForecast = hasAny(
        "forecast",
        "7 day",
        "seven day",
        "வரும் நாட்கள்",
        "முன்னறிவிப்பு"
    );

    const isVisibility = hasAny(
        "visibility",
        "visible",
        "தெரிவு"
    );

    const isPressure = hasAny(
        "pressure",
        "காற்றழுத்தம்"
    );

    const isClimate = hasAny(
        "climate",
        "காலநிலை"
    );

    const isWeather = hasAny(
        "weather",
        "today",
        "வானிலை",
        "இன்று"
    );

    let answer = "";

    if (isTomorrow && isClothes) {
        if (tomorrowRain >= 70) {
            answer = isTamil
                ? city + " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% உள்ளது. துணிகளை வெளியே காயப்போடுவது நல்லது இல்லை. முடிந்தால் வீட்டுக்குள் காயவைக்கவும்."
                : "Tomorrow in " +
                  city +
                  " there is a " +
                  tomorrowRain +
                  "% chance of rain. It is not a good idea to dry clothes outside. Try drying them indoors.";
        } else if (tomorrowRain >= 40) {
            answer = isTamil
                ? city + " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% உள்ளது. துணிகளை வெளியே காயப்போடலாம், ஆனால் மழை வர வாய்ப்பு இருப்பதால் கவனமாக இருங்கள்."
                : "There is a " +
                  tomorrowRain +
                  "% chance of rain in " +
                  city +
                  " tomorrow. You can dry clothes outside, but keep an eye on the weather.";
        } else {
            answer = isTamil
                ? city + " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% மட்டுமே. துணிகளை வெளியே காயப்போடலாம்."
                : "There is only a " +
                  tomorrowRain +
                  "% chance of rain in " +
                  city +
                  " tomorrow. Drying clothes outside should be fine.";
        }
    } else if (isTomorrow && isUmbrella) {
        if (tomorrowRain >= 50) {
            answer = isTamil
                ? "ஆம். " + city + " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% உள்ளது. குடை எடுத்துச் செல்வது நல்லது."
                : "Yes. There is a " +
                  tomorrowRain +
                  "% chance of rain in " +
                  city +
                  " tomorrow. Carrying an umbrella would be a good idea.";
        } else {
            answer = isTamil
                ? "நாளைக்கு " + city + " பகுதியில் மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% மட்டுமே. குடை தேவையில்லாமல் இருக்கலாம்."
                : "The chance of rain in " +
                  city +
                  " tomorrow is only " +
                  tomorrowRain +
                  "%. You probably won't need an umbrella.";
        }
    } else if (isTomorrow && isTravel) {
        if (tomorrowRain >= 70) {
            answer = isTamil
                ? "நாளைக்கு " + city + " பகுதியில் மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% உள்ளது. வெளியே செல்லும்போது கவனமாக இருங்கள்; பயணத்தை முடிந்தால் தவிர்ப்பது நல்லது."
                : "Tomorrow in " +
                  city +
                  " there is a " +
                  tomorrowRain +
                  "% chance of rain. Travel may be inconvenient, so consider avoiding unnecessary trips.";
        } else if (tomorrowRain >= 40) {
            answer = isTamil
                ? "நாளைக்கு " + city + " பகுதியில் மழை பெய்யும் வாய்ப்பு " +
                  tomorrowRain +
                  "% உள்ளது. வெளியே செல்லலாம், ஆனால் குடை எடுத்துச் செல்வது நல்லது."
                : "You can travel in " +
                  city +
                  " tomorrow, but there is a " +
                  tomorrowRain +
                  "% chance of rain. Carry an umbrella and be cautious.";
        } else {
            answer = isTamil
                ? "நாளைக்கு " + city + " பகுதியில் மழை வாய்ப்பு குறைவாக உள்ளது. வெளியே செல்லலாம்."
                : "The chance of rain in " +
                  city +
                  " tomorrow is low, so travelling should be fine.";
        }
    } else if (isTomorrow && isTemperature) {
        answer = isTamil
            ? city + " பகுதியில் நாளைய அதிகபட்ச வெப்பநிலை " +
              tomorrowTemperature +
              "°C ஆக இருக்கும்."
            : "Tomorrow's maximum temperature in " +
              city +
              " is expected to be " +
              tomorrowTemperature +
              "°C.";
    } else if (isTomorrow && isRain) {
        answer = isTamil
            ? city + " பகுதியில் நாளைக்கு மழை பெய்யும் வாய்ப்பு " +
              tomorrowRain +
              "% உள்ளது."
            : "There is a " +
              tomorrowRain +
              "% chance of rain in " +
              city +
              " tomorrow.";
    } else if (isTomorrow && isWeather) {
        answer = isTamil
            ? "நாளைக்கு " +
              city +
              " பகுதியில் அதிகபட்ச வெப்பநிலை " +
              tomorrowTemperature +
              "°C மற்றும் மழை வாய்ப்பு " +
              tomorrowRain +
              "% இருக்கும்."
            : "Tomorrow in " +
              city +
              ", the maximum temperature is expected to be " +
              tomorrowTemperature +
              "°C with a " +
              tomorrowRain +
              "% chance of rain.";
    } else if (isUmbrella) {
        if (rainProbability >= 50) {
            answer = isTamil
                ? "ஆம். " + city + " பகுதியில் இன்று மழை வாய்ப்பு " +
                  rainProbability +
                  "% உள்ளது. குடை எடுத்துச் செல்வது நல்லது."
                : "Yes. There is a " +
                  rainProbability +
                  "% chance of rain in " +
                  city +
                  " today. Carrying an umbrella would be a good idea.";
        } else {
            answer = isTamil
                ? city + " பகுதியில் இன்று மழை வாய்ப்பு " +
                  rainProbability +
                  "% மட்டுமே. குடை தேவையில்லாமல் இருக்கலாம்."
                : "The chance of rain in " +
                  city +
                  " today is only " +
                  rainProbability +
                  "%. You probably won't need an umbrella.";
        }
    } else if (isHumidity) {
        answer = isTamil
            ? city + " பகுதியில் தற்போதைய ஈரப்பதம் " +
              humidity +
              "% ஆக உள்ளது."
            : "The current humidity in " +
              city +
              " is " +
              humidity +
              "%.";
    } else if (isWind) {
        answer = isTamil
            ? city + " பகுதியில் தற்போதைய காற்றின் வேகம் " +
              windSpeed +
              " km/h ஆக உள்ளது."
            : "The current wind speed in " +
              city +
              " is " +
              windSpeed +
              " km/h.";
    } else if (isFeelsLike) {
        answer = isTamil
            ? city + " பகுதியில் இப்போது " +
              feelsLike +
              "°C போல உணரப்படுகிறது."
            : "It currently feels like " +
              feelsLike +
              "°C in " +
              city +
              ".";
    } else if (isRain) {
        answer = isTamil
            ? city + " பகுதியில் இன்று மழை பெய்யும் வாய்ப்பு " +
              rainProbability +
              "% உள்ளது."
            : "There is a " +
              rainProbability +
              "% chance of rain in " +
              city +
              " today.";
    } else if (isTemperature) {
        answer = isTamil
            ? city + " பகுதியில் தற்போதைய வெப்பநிலை " +
              temperature +
              "°C ஆக உள்ளது."
            : "The current temperature in " +
              city +
              " is " +
              temperature +
              "°C.";
    } else if (isAlert) {
        if (weatherCode >= 95 || rainProbability >= 80) {
            answer = isTamil
                ? city + " பகுதியில் தற்போது வானிலை நிலைமைகளை கவனமாக கண்காணிக்க வேண்டும். மழை வாய்ப்பு " +
                  rainProbability +
                  "% உள்ளது."
                : "Weather conditions in " +
                  city +
                  " require caution. The current rain probability is " +
                  rainProbability +
                  "%.";
        } else {
            answer = isTamil
                ? city + " பகுதியில் தற்போது பெரிய வானிலை ஆபத்து தெரியவில்லை."
                : "There is no major weather risk detected in " +
                  city +
                  " right now.";
        }
    } else if (isForecast) {
        answer = isTamil
            ? city + " பகுதிக்கான 7 நாள் weather forecast மேலே காட்டப்பட்டுள்ளது."
            : "The 7-day weather forecast for " +
              city +
              " is shown above.";
    } else if (isVisibility) {
        answer = isTamil
            ? city + " பகுதியில் visibility பற்றிய தகவல் weather details பகுதியில் காட்டப்பட்டுள்ளது."
            : "Visibility information for " +
              city +
              " is shown in the weather details section.";
    } else if (isPressure) {
        answer = isTamil
            ? city + " பகுதியில் காற்றழுத்தம் பற்றிய தகவல் weather details பகுதியில் காட்டப்பட்டுள்ளது."
            : "Pressure information for " +
              city +
              " is shown in the weather details section.";
    } else if (isClimate) {
        answer = isTamil
            ? "Climate என்பது ஒரு பகுதியில் நீண்ட காலமாக காணப்படும் வானிலை முறைகளை குறிக்கும். Weather என்பது குறுகிய கால வானிலை நிலை."
            : "Climate describes the long-term weather patterns of a region, while weather describes short-term atmospheric conditions.";
    } else if (isWeather) {
        answer = isTamil
            ? "இப்போது " +
              city +
              " பகுதியில் " +
              temperature +
              "°C மற்றும் " +
              getTamilCondition(condition) +
              " நிலை உள்ளது. ஈரப்பதம் " +
              humidity +
              "% மற்றும் காற்றின் வேகம் " +
              windSpeed +
              " km/h."
            : "The current weather in " +
              city +
              " is " +
              temperature +
              "°C with " +
              condition +
              " conditions. Humidity is " +
              humidity +
              "% and wind speed is " +
              windSpeed +
              " km/h.";
    } else {
        answer = isTamil
            ? "நான் weather, temperature, rain, humidity, wind, forecast, alerts மற்றும் weather-based practical questionsக்கு மட்டும் உதவ முடியும்."
            : "I can help with weather, temperature, rain, humidity, wind, forecasts, alerts and practical weather-related questions.";
    }

    const response = document.querySelector("#chatResponse");

    if (response) {
        response.textContent = answer;
    }

    input.value = "";
}
function getTamilCondition(condition) {
    if (condition === "Clear Sky")
        return "தெளிவான வானிலை";

    if (condition === "Partly Cloudy")
        return "பகுதியளவு மேகமூட்டம்";

    if (condition === "Foggy")
        return "பனிமூட்டம்";

    if (condition === "Drizzle")
        return "தூறல்";

    if (condition === "Rain")
        return "மழை";

    if (condition === "Rain Showers")
        return "மழைச் சாரல்";

    if (condition === "Thunderstorm")
        return "இடியுடன் கூடிய மழை";

    if (condition === "Snow")
        return "பனிப்பொழிவு";

    return "வானிலை";
}

function updateWeatherRisk() {
    const feelsLike =
        window.currentFeelsLike;

    const rainProbability =
        window.currentRainProbability;

    const weatherCode =
        window.currentWeatherCode;

    const heatRiskElement =
        document.querySelector("#heatRisk");

    const rainRiskElement =
        document.querySelector("#rainRisk");

    const stormRiskElement =
        document.querySelector("#stormRisk");

    const travelRiskElement =
        document.querySelector("#travelRisk");

    const recommendationElement =
        document.querySelector("#safetyRecommendation");

    if (
        !heatRiskElement ||
        !rainRiskElement ||
        !stormRiskElement ||
        !travelRiskElement ||
        !recommendationElement
    ) {
        return;
    }

    let heatRisk = "Low";
    let rainRisk = "Low";
    let stormRisk = "Low";
    let travelRisk = "Low";

    if (feelsLike >= 40) {
        heatRisk = "Very High";
    } else if (feelsLike >= 35) {
        heatRisk = "High";
    } else if (feelsLike >= 32) {
        heatRisk = "Moderate";
    }

    if (rainProbability >= 80) {
        rainRisk = "Very High";
    } else if (rainProbability >= 60) {
        rainRisk = "High";
    } else if (rainProbability >= 30) {
        rainRisk = "Moderate";
    }

    if (weatherCode >= 95) {
        stormRisk = "Very High";
    } else if (
        weatherCode >= 80 &&
        weatherCode <= 82
    ) {
        stormRisk = "High";
    } else if (
        weatherCode >= 61 &&
        weatherCode <= 67
    ) {
        stormRisk = "Moderate";
    }

    if (
        heatRisk === "Very High" ||
        rainRisk === "Very High" ||
        stormRisk === "Very High"
    ) {
        travelRisk = "High";
    } else if (
        heatRisk === "High" ||
        rainRisk === "High" ||
        stormRisk === "High"
    ) {
        travelRisk = "Moderate";
    }

    heatRiskElement.textContent =
        heatRisk;

    rainRiskElement.textContent =
        rainRisk;

    stormRiskElement.textContent =
        stormRisk;

    travelRiskElement.textContent =
        travelRisk;

    if (stormRisk === "Very High") {
        recommendationElement.textContent =
            "Thunderstorm conditions detected. Stay indoors, avoid open areas and follow local weather warnings.";

    } else if (heatRisk === "Very High") {
        recommendationElement.textContent =
            "Extreme heat conditions detected. Stay hydrated, avoid prolonged outdoor activities and seek shade.";

    } else if (rainRisk === "Very High") {
        recommendationElement.textContent =
            "Very high rain probability detected. Carry an umbrella, avoid unnecessary travel and watch for waterlogged areas.";

    } else if (stormRisk === "High") {
        recommendationElement.textContent =
            "Unstable weather conditions detected. Avoid exposed outdoor areas and monitor weather updates.";

    } else if (heatRisk === "High") {
        recommendationElement.textContent =
            "High heat stress is possible. Stay hydrated and avoid strenuous outdoor activities during peak heat.";

    } else if (rainRisk === "High") {
        recommendationElement.textContent =
            "High rain probability detected. Carry an umbrella and use caution while travelling.";

    } else {
        recommendationElement.textContent =
            "Current weather conditions appear relatively safe. Continue monitoring the forecast for changes.";
    }

    applyRiskColor(
        heatRiskElement,
        heatRisk
    );

    applyRiskColor(
        rainRiskElement,
        rainRisk
    );

    applyRiskColor(
        stormRiskElement,
        stormRisk
    );

    applyRiskColor(
        travelRiskElement,
        travelRisk
    );
}

function applyRiskColor(element, level) {
    if (level === "Very High") {
        element.style.backgroundColor = "#f8d7da";
        element.style.color = "#842029";

    } else if (level === "High") {
        element.style.backgroundColor = "#fff3cd";
        element.style.color = "#664d03";

    } else if (level === "Moderate") {
        element.style.backgroundColor = "#cff4fc";
        element.style.color = "#055160";

    } else {
        element.style.backgroundColor = "#d1e7dd";
        element.style.color = "#0f5132";
    }
}

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const chatInput =
            document.querySelector("#chatInput");

        if (chatInput) {

            chatInput.addEventListener(
                "keydown",
                function (event) {

                    if (event.key === "Enter") {
                        askWeatherGPT();
                    }
                }
            );
        }
    }
);

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const cityInput =
            document.querySelector(
                ".weather-search input"
            );

        const citySuggestion =
            document.getElementById(
                "citySuggestion"
            );

        if (
            !cityInput ||
            !citySuggestion
        ) {
            return;
        }

        let timer;

        cityInput.addEventListener(
            "input",
            function () {

                clearTimeout(timer);

                const query =
                    cityInput.value.trim();

                if (query.length < 2) {

                    citySuggestion.innerHTML =
                        "";

                    return;
                }

                timer =
                    setTimeout(
                        async function () {

                            try {

                                let results = [];

                                const openMeteoResponse =
                                    await fetch(
                                        "https://geocoding-api.open-meteo.com/v1/search?name=" +
                                        encodeURIComponent(query) +
                                        "&count=10&language=en&format=json"
                                    );

                                if (
                                    openMeteoResponse.ok
                                ) {

                                    const openMeteoData =
                                        await openMeteoResponse.json();

                                    if (
                                        openMeteoData.results
                                    ) {

                                        results =
                                            openMeteoData.results.map(
                                                function (
                                                    location
                                                ) {

                                                    return {
                                                        name:
                                                            location.name,

                                                        latitude:
                                                            location.latitude,

                                                        longitude:
                                                            location.longitude,

                                                        admin1:
                                                            location.admin1 ||
                                                            "",

                                                        country:
                                                            location.country ||
                                                            ""
                                                    };
                                                }
                                            );
                                    }
                                }

                                if (
                                    results.length === 0
                                ) {

                                    try {

                                        const osmResponse =
                                            await fetch(
                                                "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=" +
                                                encodeURIComponent(
                                                    query
                                                )
                                            );

                                        if (
                                            osmResponse.ok
                                        ) {

                                            const osmData =
                                                await osmResponse.json();

                                            results =
                                                osmData.map(
                                                    function (
                                                        place
                                                    ) {

                                                        const address =
                                                            place.address ||
                                                            {};

                                                        return {
                                                            name:
                                                                place.name ||
                                                                address.village ||
                                                                address.town ||
                                                                address.city ||
                                                                address.municipality ||
                                                                address.suburb ||
                                                                query,

                                                            latitude:
                                                                parseFloat(
                                                                    place.lat
                                                                ),

                                                            longitude:
                                                                parseFloat(
                                                                    place.lon
                                                                ),

                                                            admin1:
                                                                address.state ||
                                                                address.county ||
                                                                "",

                                                            country:
                                                                address.country ||
                                                                ""
                                                        };
                                                    }
                                                );
                                        }

                                    } catch (
                                        osmError
                                    ) {

                                        console.error(
                                            "OpenStreetMap error:",
                                            osmError
                                        );
                                    }
                                }

                                citySuggestion.innerHTML =
                                    "";

                                if (
                                    results.length === 0
                                ) {

                                    citySuggestion.innerHTML =
                                        '<div class="suggestion-item">📍 Location not found</div>';

                                    return;
                                }
                                results = results.filter(function (location, index, self) {
    return index === self.findIndex(function (item) {
        return (
            item.name.toLowerCase() === location.name.toLowerCase() &&
            item.admin1.toLowerCase() === location.admin1.toLowerCase() &&
            item.country.toLowerCase() === location.country.toLowerCase()
        );
    });
});

                                results.forEach(
                                    function (
                                        location
                                    ) {

                                        const item =
                                            document.createElement(
                                                "div"
                                            );

                                        item.className =
                                            "suggestion-item";

                                        item.textContent =
                                            "📍 " +
                                            location.name +
                                            (
                                                location.admin1
                                                    ? ", " +
                                                      location.admin1
                                                    : ""
                                            ) +
                                            (
                                                location.country
                                                    ? ", " +
                                                      location.country
                                                    : ""
                                            );

                                        item.addEventListener(
                                            "click",
                                            function () {

                                                cityInput.value =
                                                    location.name;

                                                citySuggestion.innerHTML =
                                                    "";

                                                goToWeatherPage();
                                            }
                                        );

                                        citySuggestion.appendChild(
                                            item
                                        );
                                    }
                                );

                            } catch (
                                error
                            ) {

                                console.error(
                                    "Suggestion error:",
                                    error
                                );

                            }

                        },
                        300
                    );
            }
        );

        document.addEventListener(
            "click",
            function (event) {

                if (
                    !cityInput.contains(
                        event.target
                    ) &&
                    !citySuggestion.contains(
                        event.target
                    )
                ) {

                    citySuggestion.innerHTML =
                        "";
                }
            }
        );
    }
);

function goToWeatherPage() {

    const cityInput =
        document.querySelector(
            ".weather-search input"
        );

    if (!cityInput)
        return;

    const city =
        cityInput.value.trim();

    if (city === "") {

        alert(
            "Please enter a city name"
        );

        return;
    }

    window.location.href =
        "weather.html?city=" +
        encodeURIComponent(city);
}

const params =
    new URLSearchParams(
        window.location.search
    );

const selectedCity =
    params.get("city");

if (
    selectedCity &&
    window.location.pathname.includes(
        "weather.html"
    )
) {

    const cityDisplay =
        document.querySelector(
            "#selectedCity"
        );

    if (cityDisplay) {

        cityDisplay.textContent =
            "Weather information for " +
            selectedCity;
    }

    const input =
        document.querySelector(
            ".weather-search input"
        );

    if (input) {

        input.value =
            selectedCity;
    }

    searchWeather(
        selectedCity
    );
}

console.log(
    "WeatherGPT JavaScript loaded successfully!"
);
