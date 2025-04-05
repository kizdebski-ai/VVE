import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'


const routes = [
  {
    // Redirect the root path to a default board
    path: '/',
    redirect: '/board/default' 
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
