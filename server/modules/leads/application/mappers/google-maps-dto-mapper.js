export function mapGoogleMapsPlaceMatch(place) {
  if (!place) {
    return null
  }

  return {
    name: place.title,
    address: place.address,
    phone: place.phone,
    website: place.url,
    rating: place.googleRating,
    businessStatus: place.googleBusinessStatus,
    types: place.googleTypes,
    placeId: place.googlePlaceId,
    location: null
  }
}
