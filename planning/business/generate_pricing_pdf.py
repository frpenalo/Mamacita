# -*- coding: utf-8 -*-
"""Genera el one-pager de precios Mamacita x NXTUP para compartir con socios."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

OUT = r"C:\Users\frami\Proyectos\mamacita\planning\business\Mamacita-NXTUP-Precios-2026-06-10.pdf"

# Paleta
DARK = HexColor("#1a1a2e")
ACCENT = HexColor("#e94560")
SOFT = HexColor("#f4f4f8")
MID = HexColor("#16213e")
GRAY = HexColor("#6b7280")
GREEN = HexColor("#0d7a4f")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "TitleX", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=20, textColor=DARK, spaceAfter=2, alignment=TA_CENTER,
)
subtitle_style = ParagraphStyle(
    "SubtitleX", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.5, textColor=GRAY, alignment=TA_CENTER, spaceAfter=6,
)
h2 = ParagraphStyle(
    "H2X", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12.5, textColor=MID, spaceBefore=8, spaceAfter=4,
)
body = ParagraphStyle(
    "BodyX", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.5, textColor=DARK, leading=13,
)
small = ParagraphStyle(
    "SmallX", parent=styles["Normal"], fontName="Helvetica",
    fontSize=8.5, textColor=GRAY, leading=11.5,
)
bullet = ParagraphStyle(
    "BulletX", parent=body, leftIndent=14, bulletIndent=4, spaceAfter=2,
)

def cell(text, bold=False, color=DARK, size=9.5, align="LEFT"):
    st = ParagraphStyle(
        f"cell_{bold}_{size}_{align}", parent=body, fontSize=size,
        fontName="Helvetica-Bold" if bold else "Helvetica",
        textColor=color, alignment={"LEFT": 0, "CENTER": 1, "RIGHT": 2}[align],
        leading=size + 3,
    )
    return Paragraph(text, st)

doc = SimpleDocTemplate(
    OUT, pagesize=letter,
    topMargin=0.45 * inch, bottomMargin=0.4 * inch,
    leftMargin=0.7 * inch, rightMargin=0.7 * inch,
    title="Mamacita x NXTUP - Propuesta de Precios",
    author="Francisco",
)

story = []

story.append(Paragraph("Propuesta de Precios", title_style))
story.append(Paragraph(
    "Mamacita (agentes IA) + NXTUP (queue management) &nbsp;|&nbsp; 10 de junio de 2026 &nbsp;|&nbsp; Para discusión entre socios",
    subtitle_style,
))

# ---------------- Planes para shops ----------------
story.append(Paragraph("1. Planes para shops (à la carte)", h2))
story.append(Paragraph(
    "Cada agente es un add-on independiente sobre NXTUP base. El shop arma su combinación:",
    body,
))
story.append(Spacer(1, 6))

shop_data = [
    [cell("Plan", bold=True, color=white),
     cell("Qué incluye", bold=True, color=white),
     cell("Precio lista", bold=True, color=white, align="CENTER"),
     cell("Founding*", bold=True, color=white, align="CENTER")],
    [cell("NXTUP", bold=True),
     cell("Queue management completo (walk-ins, FIFO de barberos, kiosk, PWA, TV display)"),
     cell("$47/mes", bold=True, align="CENTER"),
     cell("—", align="CENTER")],
    [cell("NXTUP + Agente WhatsApp", bold=True),
     cell("Agente de texto que agenda citas y mantiene la comunicación cliente–barbero"),
     cell("$87/mes", bold=True, align="CENTER"),
     cell("$77/mes", bold=True, color=GREEN, align="CENTER")],
    [cell("NXTUP + Agente de Voz", bold=True),
     cell("Contesta llamadas, gestiona lista de espera walk-in, toma mensajes"),
     cell("$100/mes", bold=True, align="CENTER"),
     cell("$90/mes", bold=True, color=GREEN, align="CENTER")],
    [cell("NXTUP + Ambos agentes", bold=True),
     cell("WhatsApp + Voz — ahorro de $10 vs contratarlos por separado"),
     cell("$130/mes", bold=True, align="CENTER"),
     cell("$120/mes", bold=True, color=GREEN, align="CENTER")],
]

shop_table = Table(shop_data, colWidths=[1.7 * inch, 3.1 * inch, 1.15 * inch, 1.15 * inch])
shop_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), MID),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
    ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
]))
story.append(shop_table)
story.append(Spacer(1, 5))
story.append(Paragraph(
    "*<b>Founding members:</b> $10/mes de descuento en cualquier plan con agente, garantizado por 6 meses, "
    "para los primeros 20–30 shops. Al cumplirse los 6 meses, el plan pasa a precio de lista.",
    small,
))

# ---------------- Plan personal ----------------
story.append(Paragraph("2. Plan Personal — para barberos individuales", h2))
story.append(Paragraph(
    "Cualquier barbero (dentro o fuera de un shop NXTUP) puede contratar su agente personal. "
    "El agente personal maneja el libro de citas propio del barbero con su clientela; "
    "no interfiere con la cola walk-in del shop.",
    body,
))
story.append(Spacer(1, 6))

personal_data = [
    [cell("Plan Personal", bold=True, color=white),
     cell("Qué incluye", bold=True, color=white),
     cell("Precio", bold=True, color=white, align="CENTER")],
    [cell("WhatsApp personal", bold=True),
     cell("Agente de texto: agenda y confirma citas con la clientela propia del barbero"),
     cell("$29/mes", bold=True, align="CENTER")],
    [cell("Voz personal", bold=True),
     cell("Número propio con agente que contesta llamadas y agenda citas"),
     cell("$59/mes", bold=True, align="CENTER")],
    [cell("Ambos", bold=True),
     cell("WhatsApp + Voz para el barbero — ahorro de $9 vs por separado"),
     cell("$79/mes", bold=True, align="CENTER")],
]
personal_table = Table(personal_data, colWidths=[1.7 * inch, 4.25 * inch, 1.15 * inch])
personal_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
    ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
]))
story.append(personal_table)
story.append(Spacer(1, 5))
story.append(Paragraph(
    "<b>Canal de venta:</b> si el barbero contrata desde el app de NXTUP, la venta cuenta como canal NXTUP "
    "(aplica el split acordado). Si llega directo a Mamacita, es venta directa de Mamacita.",
    small,
))

# ---------------- Racional ----------------
story.append(Paragraph("3. Racional de los precios", h2))
for txt in [
    "<bullet>&bull;</bullet> El incremento del agente de voz (+$53 solo, +$43 dentro del bundle) está calculado para cubrir "
    "el costo por minuto del proveedor de voz incluso en shops con alto volumen de llamadas.",
    "<bullet>&bull;</bullet> El agente de WhatsApp tiene costo operativo muy bajo, lo que da margen sano incluso con el precio founding.",
    "<bullet>&bull;</bullet> Durante el piloto se registra el costo real por llamada (telemetría). Los precios se confirman "
    "o ajustan con esos datos antes del lanzamiento general.",
    "<bullet>&bull;</bullet> El descuento de bundle ($10) incentiva el plan completo en ambas direcciones de venta.",
]:
    story.append(Paragraph(txt, bullet))

# ---------------- Pendientes ----------------
story.append(Paragraph("4. Puntos a acordar entre socios", h2))
for txt in [
    "<bullet>&bull;</bullet> <b>Split de revenue NXTUP ↔ Mamacita por cada combo</b> (los incrementos de WhatsApp y voz son tecnología de Mamacita).",
    "<bullet>&bull;</bullet> <b>Política sobre agentes personales:</b> cómo se presenta el Plan Personal a los barberos dentro de shops NXTUP.",
    "<bullet>&bull;</bullet> <b>Fecha de corte del precio founding</b> (propuesta: primeros 20–30 shops o primeros 90 días, lo que ocurra primero).",
]:
    story.append(Paragraph(txt, bullet))

story.append(Spacer(1, 10))
story.append(Paragraph(
    "Documento de trabajo — precios sujetos a validación con datos del piloto. Preparado por Francisco · Mamacita.",
    ParagraphStyle("footer", parent=small, alignment=TA_CENTER),
))

doc.build(story)
print(f"OK: {OUT}")
