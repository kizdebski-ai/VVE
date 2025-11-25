# WhiteVue

WhiteVue is a high-performance, real-time collaborative whiteboard built for technical teams. It merges the flexibility of a vector-based canvas with the reliability of CRDT synchronization, allowing multiple users to brainstorm, diagram, and solve problems together without conflict.

**Live Demo:** [https://frontend-copy-production-2b71.up.railway.app](https://frontend-copy-production-2b71.up.railway.app)

## Architecture Overview

WhiteVue adopts a **Local-First** architecture. The application state lives primarily on the client, managed by a CRDT (Conflict-free Replicated Data Type) document. Synchronization happens in the background via WebSockets, ensuring the app remains responsive even under poor network conditions.

```mermaid
graph TD
    subgraph Client [Frontend (Vue 3 + Vite)]
        State[Yjs Doc (CRDT)]
        Renderer[Hybrid Renderer]
        Input[Input Handler]
        
        Input --> State
        State --> Renderer
        Renderer --> Canvas[Rough.js Canvas]
        Renderer --> DOM[Interactive Overlay]
    end

    subgraph Server [Backend (Node.js)]
        WSS[WebSocket Server]
        Persistence[In-Memory / DB]
    end

    State <-->|Binary Updates| WSS
    WSS <--> Persistence
    WSS <-->|Broadcast| Client2[Other Clients]
```

## Core Engineering Challenges & Solutions

Building a whiteboard that feels "native" while supporting real-time multiplayer involves solving several complex distributed system problems.

### 1. The "Sticky" Binding System
**The Challenge:** In a diagramming tool, lines must stay attached to shapes. If a user connects an arrow to a rectangle and then rotates that rectangle 45 degrees, the arrow should follow the specific anchor point (e.g., "top-center") naturally. Standard bounding-box logic fails here.

**The Solution:** We implemented a custom **Binding Protocol** on top of our CRDT structure.
*   Instead of just storing `x,y` coordinates for line endpoints, we store a `bindingPayload` containing the target object's ID and a normalized relative coordinate (e.g., `0.5, 0` for top-center).
*   We utilize **Yjs Transactions** (`ydoc.transact`) to create atomic updates. When a shape is moved or resized, a reactive watcher detects the change and triggers a `auto-binding` transaction that recalculates and updates the coordinates of all attached lines in the same tick. This ensures that all users see the lines move in perfect sync with the shape, with no visual lag or "detachment" artifacts.

### 2. Hybrid Rendering Pipeline
**The Challenge:** HTML5 Canvas is performant for drawing thousands of strokes but poor for interaction (no DOM events for individual shapes). DOM elements are great for interaction but heavy to render in large numbers.

**The Solution:** WhiteVue uses a **Dual-Layer Rendering Engine**:
*   **The Bottom Layer (Canvas):** Uses **Rough.js** to render the actual visual content. This library generates "hand-drawn" SVG paths which we rasterize onto a single HTML5 Canvas. This provides the aesthetic appeal and high rendering performance (60fps even with complex scenes).
*   **The Top Layer (Vue Components):** We overlay lightweight Vue components (`MovableObject`) on top of the canvas. These components are invisible by default but handle hit-testing, selection boxes, and resize handles.
*   **Synchronization:** A central `CoordinateSystem` utility maps the infinite pan/zoom canvas space to the viewport pixels, ensuring the DOM overlay always aligns perfectly with the canvas drawing, even during multi-touch pinch-to-zoom gestures.

### 3. Conflict-Free State Management
**The Challenge:** In a naive implementation, if User A moves an object and User B deletes it simultaneously, the app crashes. Or if two users drag the same object, it "jitters" between positions.

**The Solution:** We use **Yjs** as our source of truth.
*   **Data Structure:** The entire board state is a `Y.Array` of `Y.Map` objects.
*   **Resolution:** Yjs automatically handles property conflicts using a "Last-Write-Wins" strategy for simple properties (like color) and sophisticated list merging for array data.
*   **Awareness:** For ephemeral data that shouldn't be saved (like cursor positions or "who is selecting what"), we use the `y-protocols/awareness` protocol. This broadcasts tiny binary packets separate from the main document history, keeping the persistent storage clean and lightweight.

### 4. AI Vision Context
**The Challenge:** Text-only AI assistants are useless on a whiteboard. The AI needs to "see" the diagram to understand context (e.g., "Is this architecture diagram secure?").

**The Solution:** We integrated a **Multimodal RAG (Retrieval-Augmented Generation)** pipeline.
*   When a user asks a question, we capture a high-resolution viewport snapshot of the canvas.
*   We combine this visual data with a serialized JSON representation of the selected elements.
*   This context is sent to a Vision-Language Model (like GPT-4o or Claude 3.5 Sonnet), allowing the AI to reason about spatial relationships and visual content, not just text.

## Tech Stack

*   **Frontend:** Vue 3, Vite, TailwindCSS (for UI panels)
*   **Graphics:** HTML5 Canvas, Rough.js (hand-drawn style), Katex (math rendering)
*   **State:** Yjs (CRDT), y-websocket
*   **Backend:** Node.js, Express, WebSocket (ws)

## Installation

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/your-username/WhiteVue.git
    cd WhiteVue
    ```

2.  **Start Backend:**
    ```bash
    cd server
    npm install
    npm run dev
    ```

3.  **Start Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4.  **Open:** `http://localhost:5173`

## Future Roadmap

*   **End-to-End Encryption:** Client-side encryption of Yjs updates before they hit the WebSocket.
*   **Time Travel:** A slider to replay the entire history of the whiteboard session.
*   **Plugin System:** API for third-party developers to add custom shapes and tools.
