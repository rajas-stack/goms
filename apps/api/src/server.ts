import { buildApp } from './app.js'

const app = await buildApp()
app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })
