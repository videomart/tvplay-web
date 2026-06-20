import nodemailer from 'nodemailer'
import { config } from '../config'

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransporter() {
  if (!config.smtp.host) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  }
  return transporter
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
  const t = getTransporter()
  if (!t) throw new Error('SMTP não configurado neste servidor')

  await t.sendMail({
    from: config.smtp.from || config.smtp.user,
    to,
    subject: 'TVPlay — Redefinição de senha',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #111827;">Redefinição de senha</h2>
        <p>Olá, ${name},</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no TVPlay.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block; background:#4f46e5; color:#fff; padding:10px 20px; border-radius:6px; text-decoration:none; font-weight:bold;">
            Redefinir senha
          </a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">Este link expira em 1 hora. Se você não solicitou isso, ignore este email.</p>
      </div>
    `,
  })
}
