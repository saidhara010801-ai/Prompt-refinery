## Project Overview

Firebase Studio is a powerful, opinionated starter kit designed to streamline the development of Next.js applications integrated with Firebase. It provides a robust foundation, combining the best practices of modern web development with the comprehensive backend services offered by Google Firebase. This tool aims to accelerate your development workflow, allowing you to focus on building unique features rather than wrestling with initial setup and configurations.

## Highlights & Features

*   **Next.js Framework:** Leverage the full power of Next.js for server-side rendering (SSR), static site generation (SSG), API routes, and a world-class developer experience.
*   **Seamless Firebase Integration:** Pre-configured and optimized for Firebase services including Authentication, Firestore, Storage, Cloud Functions, and Hosting. Get up and running with your backend in minutes.
*   **Authentication Flow:** Ready-to-use authentication components and hooks, supporting various providers (Google, Email/Password, etc.), simplifying user management.
*   **Database (Firestore) Integration:** Examples and utilities for interacting with Firestore, enabling real-time data synchronization and powerful NoSQL database capabilities.
*   **Optimized Performance:** Built with performance in mind, ensuring fast load times and a smooth user experience.
*   **Scalability:** Designed to scale effortlessly from small projects to large-scale applications, leveraging Firebase's infrastructure.
*   **Developer Experience (DX):** Thoughtfully structured project layout, comprehensive type safety (TypeScript), and pre-configured linters/formatters ensure a pleasant and productive development environment.
*   **Deployment Ready:** Easily deployable to Firebase Hosting, Vercel, or any other Next.js compatible platform.

## Getting Started

Follow these steps to get your Firebase Studio project up and running:

### Prerequisites

*   Node.js (LTS version recommended)
*   npm or Yarn
*   A Firebase Project (create one at [console.firebase.google.com](https://console.firebase.google.com))
*   Firebase CLI installed globally (`npm install -g firebase-tools`)

### Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone [your-repository-url]
    cd [your-project-name]
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Connect to your Firebase Project:**
    Log in to Firebase via the CLI (if you haven't already):
    ```bash
    firebase login
    ```
    Then, link your local project to your Firebase project:
    ```bash
    firebase use --add
    ```
    Select your desired Firebase project from the list.

4.  **Configure Firebase Environment Variables:**
    Create a `.env.local` file in the root of your project and add your Firebase configuration details. You can find these in your Firebase project settings -> "Project settings" -> "Your apps" -> "Web app" -> "Config".

    ```env
    NEXT_PUBLIC_FIREBASE_API_KEY="YOUR_API_KEY"
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="YOUR_AUTH_DOMAIN"
    NEXT_PUBLIC_FIREBASE_PROJECT_ID="YOUR_PROJECT_ID"
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="YOUR_STORAGE_BUCKET"
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="YOUR_MESSAGING_SENDER_ID"
    NEXT_PUBLIC_FIREBASE_APP_ID="YOUR_APP_ID"
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="YOUR_MEASUREMENT_ID"
    ```
    **Note:** Make sure these are `NEXT_PUBLIC_` prefixed for client-side access in Next.js.

5.  **Run the Development Server:**
    ```bash
    npm run dev
    # or
    yarn dev
    ```
    Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

6.  **Deploy to Firebase Hosting (Optional):**
    First, build your Next.js application:
    ```bash
    npm run build
    # or
    yarn build
    ```
    Then, deploy to Firebase Hosting:
    ```bash
    firebase deploy --only hosting
    ```

### Recommended Next Steps

*   Explore `src/app/page.tsx` for the main application entry point.
*   Check the `firebase/` directory for Firebase-related configurations and utility functions.
*   Familiarize yourself with the folder structure and existing components.
*   Refer to the [Next.js Documentation](https://nextjs.org/docs) and [Firebase Documentation](https://firebase.google.com/docs) for detailed guides.
