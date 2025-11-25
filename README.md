# 🎨 WhiteVue - Collaborative AI Whiteboard

![Project Status](https://img.shields.io/badge/Status-Active_Development-success)
![Vue.js](https://img.shields.io/badge/Frontend-Vue_3-42b883)
![Node.js](https://img.shields.io/badge/Backend-Node.js-339933)
![Yjs](https://img.shields.io/badge/Sync-Yjs_CRDT-orange)
![Vite](https://img.shields.io/badge/Build-Vite-646cff)

**WhiteVue** to zaawansowana, działająca w czasie rzeczywistym tablica kolaboracyjna (whiteboard), wzbogacona o asystenta AI, obsługę wykresów matematycznych i fizycznych oraz nowoczesny interfejs w stylu Glassmorphism.

🚀 **Live Demo:** [https://frontend-copy-production-2b71.up.railway.app](https://frontend-copy-production-2b71.up.railway.app)

---

## 🌟 Kluczowe Funkcjonalności

*   **Kolaboracja w Czasie Rzeczywistym:** Wielu użytkowników może rysować i edytować jednocześnie. Widoczność kursorów i awatarów innych uczestników.
*   **Inteligentny Asystent AI:** Zintegrowany Chatbot, który "widzi" tablicę (OCR/Vision) i pomaga w rozwiązywaniu zadań matematycznych czy generowaniu pomysłów.
*   **System Kształtów i Linii:** Rysowanie odręczne (Pen), kształty geometryczne (Rough.js), edytowalne linie łączące, tekst.
*   **Narzędzia Naukowe:**
    *   Panel Matematyczny (wykresy funkcji).
    *   Panel Fizyczny (symulacje).
    *   Generator Diagramów.
*   **Eksport:** Możliwość zapisu tablicy do PDF (pojedyncza strona lub stronicowany) oraz JSON.
*   **Premium UI:** Nowoczesny design "Frosted Glass", tryb ciemny/jasny, płynne animacje.

---

## 🏗️ Architektura i Uzasadnienie Stosu Technologicznego

Projekt został zbudowany z myślą o wydajności, skalowalności i natychmiastowej reaktywności.

### 1. Frontend: Vue 3 + Vite
Wybraliśmy **Vue 3 (Composition API)** ze względu na jego znakomitą wydajność i elastyczność w zarządzaniu skomplikowanym stanem aplikacji.
*   **Reaktywność:** System reaktywności Vue 3 idealnie współgra z dynamicznymi zmianami na tablicy.
*   **Komponentowość:** Modularna budowa (`WhiteboardCanvas`, `ToolBar`, `AIChatPanel`) ułatwia utrzymanie kodu.
*   **Vite:** Zapewnia błyskawiczny HMR (Hot Module Replacement) i szybkie buildy produkcyjne.

### 2. Synchronizacja Danych: Yjs (CRDT) + WebSocket
Sercem kolaboracji jest **Yjs** – biblioteka implementująca algorytmy **CRDT (Conflict-free Replicated Data Types)**.
*   **Dlaczego CRDT?** W przeciwieństwie do prostego przesyłania zdarzeń, CRDT gwarantuje, że wszyscy użytkownicy osiągną ten sam stan końcowy, niezależnie od kolejności otrzymania pakietów i opóźnień sieciowych. Rozwiązuje to problem konfliktów edycji bez potrzeby centralnego blokowania zasobów.
*   **Protokół:** Komunikacja odbywa się przez WebSockety (`y-websocket`), co zapewnia minimalne opóźnienia (low-latency).

### 3. Backend: Node.js + Express
Lekki serwer sygnalizacyjny odpowiedzialny za:
*   Obsługę połączeń WebSocket.
*   Zarządzanie pokojami (Rooms).
*   Serwowanie statycznych plików frontendu (w produkcji).
*   Proxy dla zapytań AI (bezpieczeństwo kluczy API).

### 4. Rendering: Canvas & Rough.js
Do renderowania grafiki używamy natywnego HTML5 Canvas wspomaganego przez **Rough.js**, co nadaje rysunkom estetyczny, "odręczny" styl, sprawiając, że aplikacja jest bardziej przyjazna i mniej techniczna w odbiorze.

---

## 🛠️ Wyzwania Techniczne i Rozwiązania

Podczas tworzenia WhiteVue napotkaliśmy szereg wyzwań inżynieryjnych. Oto jak je rozwiązaliśmy:

### 1. Konflikty UI i Responsywność
**Problem:** Przy dużej liczbie narzędzi, panele (Chat AI, Toolbar, Status E2E) zaczęły na siebie nachodzić, szczególnie na mniejszych ekranach.
**Rozwiązanie:**
*   Wdrożenie precyzyjnego pozycjonowania CSS (`fixed`, `z-index`) z systemem zmiennych.
*   Dynamiczne ukrywanie/minimalizowanie paneli (np. Chatbot zwijany do małej ikonki).
*   Inteligentne wyrównanie elementów (np. status E2E przesunięty względem kontrolek Zoomu, awatary użytkowników przeniesione nad Toolbar).

### 2. Edycja Linii i Połączeń
**Problem:** Standardowe skalowanie obiektów (bounding box) nie sprawdzało się przy liniach łączących, gdzie użytkownik chce przesunąć tylko jeden koniec linii.
**Rozwiązanie:**
*   Stworzenie dedykowanej logiki obsługi zdarzeń dla obiektów typu `line`.
*   Implementacja niezależnych uchwytów (`start-handle`, `end-handle`) z własną logiką aktualizacji współrzędnych w modelu Yjs (`local-line-resize`).

### 3. Synchronizacja Stanu "Awareness"
**Problem:** Pokazywanie kursorów i nazw użytkowników w czasie rzeczywistym bez obciążania głównego kanału danych.
**Rozwiązanie:**
*   Wykorzystanie protokołu `y-protocols/awareness`. Dane efemeryczne (pozycja kursora, zaznaczenie) są przesyłane oddzielnym, lekkim kanałem i nie są zapisywane w historii dokumentu, co drastycznie zmniejsza narzut danych.

### 4. "Duchy" w UI (Ghost Text)
**Problem:** W panelu AI Chat pojawiał się szary tekst (placeholder/sugestia), który nie znikał, myląc użytkownika.
**Rozwiązanie:**
*   Wdrożenie warunkowego renderowania (`v-if`) dla elementu `.ghost`, który wyświetla się tylko wtedy, gdy asystent faktycznie ma sugestię do uzupełnienia (`suggestionTail`).

---

## 🔮 Roadmap (To-Do)

Przyszłość WhiteVue to bezpieczeństwo i jeszcze lepsza integracja.

*   [ ] **Szyfrowanie E2E (End-to-End):**
    *   Implementacja pełnego szyfrowania po stronie klienta przy użyciu Web Crypto API.
    *   Serwer nie będzie miał dostępu do treści tablicy – jedynie przekaże zaszyfrowane bloby.
    *   Status "E2E Encrypted" w UI.
*   [ ] **Wersjonowanie Historii:** Możliwość przywrócenia tablicy do stanu z konkretnej godziny.
*   [ ] **Wsparcie dla Tabletów:** Lepsza obsługa zdarzeń dotykowych (Touch Events) i obsługa rysika (Pressure sensitivity).
*   [ ] **Więcej Integracji AI:** Generowanie całych diagramów na podstawie opisu tekstowego.

---

## 🚀 Instrukcja Uruchomienia (Lokalnie)

Wymagania: Node.js v16+

1.  **Sklonuj repozytorium:**
    ```bash
    git clone https://github.com/your-repo/whitevue.git
    cd whitevue
    ```

2.  **Uruchom Backend:**
    ```bash
    cd server
    npm install
    npm run dev
    ```

3.  **Uruchom Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4.  **Otwórz w przeglądarce:**
    Wejdź na `http://localhost:5173` (lub port wskazany przez Vite).

---

## 📄 Licencja

Projekt stworzony w celach edukacyjnych i demonstracyjnych.
Copyright © 2025 WhiteVue Team.
