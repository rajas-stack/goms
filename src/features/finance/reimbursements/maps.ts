import type { Place } from './model'

/** Browser key with Maps JavaScript, Places (New) and Routes APIs enabled, restricted to this site. Without it the
 *  route fields are plain text and km is entered by hand. */
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
export const mapsEnabled = () => KEY !== ''

export interface Suggestion { placeId: string; main: string; secondary: string; toPlace: () => Promise<Place> }

interface PlacesLib {
  AutocompleteSessionToken: new () => object
  AutocompleteSuggestion: { fetchAutocompleteSuggestions: (req: object) => Promise<{ suggestions: { placePrediction: PlacePrediction | null }[] }> }
}
interface PlacePrediction {
  placeId: string
  mainText?: { text: string } | null
  secondaryText?: { text: string } | null
  toPlace: () => { fetchFields: (o: { fields: string[] }) => Promise<unknown>; displayName?: string | null; formattedAddress?: string | null; location?: { lat: () => number; lng: () => number } | null }
}
type MapsWindow = Window & { google?: { maps?: { importLibrary: (name: string) => Promise<unknown> } }; __gomsMapsReady?: () => void }

let placesPromise: Promise<PlacesLib> | undefined
function places(): Promise<PlacesLib> {
  if (!placesPromise) {
    placesPromise = new Promise<void>((resolve, reject) => {
      const w = window as MapsWindow
      if (w.google?.maps?.importLibrary) { resolve(); return }
      w.__gomsMapsReady = () => resolve()
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__gomsMapsReady`
      script.async = true
      script.onerror = () => reject(new Error('Google Maps could not load.'))
      document.head.appendChild(script)
    }).then(() => (window as MapsWindow).google!.maps!.importLibrary('places') as Promise<PlacesLib>)
    placesPromise.catch(() => { placesPromise = undefined })
  }
  return placesPromise
}

let token: object | undefined
/** Place suggestions for what the user typed, biased to India. One billing session lasts until a place is picked. */
export async function suggestPlaces(input: string): Promise<Suggestion[]> {
  if (!mapsEnabled() || input.trim().length < 2) return []
  const lib = await places()
  token ??= new lib.AutocompleteSessionToken()
  const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: token, includedRegionCodes: ['in'] })
  return suggestions.flatMap(({ placePrediction: p }) => p ? [{
    placeId: p.placeId, main: p.mainText?.text ?? '', secondary: p.secondaryText?.text ?? '',
    toPlace: async (): Promise<Place> => {
      const place = p.toPlace()
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
      token = undefined
      return {
        name: place.displayName ?? p.mainText?.text ?? '', address: place.formattedAddress ?? undefined, placeId: p.placeId,
        lat: place.location?.lat(), lng: place.location?.lng(),
      }
    },
  }] : [])
}

const located = (p: Place): p is Place & { lat: number; lng: number } => typeof p.lat === 'number' && typeof p.lng === 'number'
const waypoint = (p: { lat: number; lng: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })

/** Road distance through every stop in order, in km (2 decimals); null when a stop has no location or Maps is off. */
export async function routeKm(route: Place[]): Promise<number | null> {
  if (!mapsEnabled() || route.length < 2 || !route.every(located)) return null
  const stops = route.filter(located)
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'routes.distanceMeters' },
    body: JSON.stringify({
      origin: waypoint(stops[0]), destination: waypoint(stops[stops.length - 1]),
      intermediates: stops.slice(1, -1).map(waypoint), travelMode: 'DRIVE',
    }),
  })
  if (!response.ok) throw new Error('Google could not work out the distance for this route.')
  const meters = ((await response.json()) as { routes?: { distanceMeters?: number }[] }).routes?.[0]?.distanceMeters
  return typeof meters === 'number' ? Math.round(meters / 10) / 100 : null
}
