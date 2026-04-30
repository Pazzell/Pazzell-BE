"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Import the functions you need from the SDKs you need
const app_1 = require("firebase/app");
const analytics_1 = require("firebase/analytics");
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyB1jBGa7Pdp-9NXHtTjVZnA2JqmuqGO37I",
    authDomain: "mybrandpuzzle.firebaseapp.com",
    projectId: "mybrandpuzzle",
    storageBucket: "mybrandpuzzle.firebasestorage.app",
    messagingSenderId: "885035572648",
    appId: "1:885035572648:web:a9b48767d395807598119d",
    measurementId: "G-T0JDWM1JFL",
};
// Initialize Firebase
const app = (0, app_1.initializeApp)(firebaseConfig);
const analytics = (0, analytics_1.getAnalytics)(app);
