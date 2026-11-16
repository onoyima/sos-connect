Pod::Spec.new do |s|
  s.name           = 'MeshNearby'
  s.version        = '1.0.0'
  s.summary        = 'MultipeerConnectivity transport for SOS Connect'
  s.author         = 'SOS Connect'
  s.homepage       = 'https://sos.example.com'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'MultipeerConnectivity'
  s.source_files   = '**/*.swift'
end
