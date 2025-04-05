import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: App,
  },
  {
    path: '/board/:roomId',
    name: 'Whiteboard',
    component: App,
    props: true
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
