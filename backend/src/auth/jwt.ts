import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export interface TokenPayload {
  sub: string // userId
  email: string
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions)
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload
}
